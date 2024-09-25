/* global fetch, process */

import {
  iterateReverse,
  makeFollower,
  makeLeader
} from "@agoric/casting";
import {
  makeRpcUtils,
  boardSlottingMarshaller,
  networkConfig,
  storageHelper,
  makeFromBoard,
  makeVStorage,
} from "../lib/rpc.js";
import { getCurrent } from "../lib/wallet.js";
import { execSwingsetTransaction } from "../lib/chain.js";
import {
  delay
} from "./utils.js";
import { checkIfInSubmission } from "./middleware-helper.js"
import { getNextSequence, incrementSequence, setSequenceNumber, updateTable, queryTable } from "./db.js";
import middlewareEnvInstance from './middleware-env.js';
import { logger } from "./logger.js";
import { RoundDetails } from "./round-details.js";
import { execSync } from 'child_process';
import axios from "axios";
import { FeedsConfig } from "../helpers/feeds-config.js";

const marshaller = boardSlottingMarshaller();
let feedsConfig = new FeedsConfig();

let MAX_OFFERS_TO_LOOP = 25;

/**
 * Function to get the latest block height and whether the node is syncing
 * @returns {object} A key height which holds the latest block number or 0 if it fails and a key syncing which holds whether the node is still syncing
 */
export const getLatestBlockHeight = async () => {
  try {
    // Construct the URL
    const apiUrl = `${middlewareEnvInstance.AGORIC_RPC}/status`;

    // Make the GET request
    const response = await axios.get(apiUrl);

    // Parse the JSON response
    const responseData = response.data;

    // Extract the latest_block_height
    const latestBlockHeight = responseData.result.sync_info.latest_block_height;
    const catchingUp = responseData.result.sync_info.catching_up;
    // Calculate time behind 
    const latestBlockTime = new Date(responseData.result.sync_info.latest_block_time);
    const now = new Date();
    // Check if more than 1 minute behind
    const behind = now - latestBlockTime > (60 * 1000)

    // Convert it to a number
    const latestBlockHeightNumber = Number(latestBlockHeight);

    return {
      height: latestBlockHeightNumber,
      syncing: catchingUp || behind
    };

  } catch (error) {
    // Handle errors
    console.error('Failed to get block height:', error.message);
    return {
      height: 0,
      syncing: true
    };
  }
}

/**
 * Function to read from vstorage
 *
 * In Agoric, vStorage is a virtual storage system used by smart contracts to
 * store and manage data in a secure and decentralized way, with isolated
 * permissions and standardized APIs for external storage.
 *
 * @param {string} feed the feed to read (Ex. ATOM-USD)
 * @param {boolean} roundData whether to read round data or price data
 * @returns {string} CapData of result
 */
export const readVStorage = async (feed, roundData) => {
  const vstorage = makeVStorage({ fetch });
  let key = roundData
    ? `published.priceFeed.${feed}_price_feed.latestRound`
    : `published.priceFeed.${feed}_price_feed`;
  return await vstorage.readLatest(key);
};

/**
 * Function to get last 5 offers
 * @param {Promise<import('@agoric/casting/src/follower-cosmjs').ValueFollower<T>>} follower offers and balances
 * @returns {object[]} a list of offers
 */
export const getOffers = async (follower) => {
  let history = [];
  let count = 0;
  let query = await queryTable("last_successful", ["id"], "all");

  let lastVisited = (query && query.id) || -1;

  for await (const followerElement of iterateReverse(follower)) {
    if (history.length === 10 || count == MAX_OFFERS_TO_LOOP) {
      break;
    }

    // If it is an offer status
    if (followerElement.value.updated === "offerStatus") {
      // Get id
      let id = followerElement.value.status.id;

      // if (id<= lastVisited)
      // {
      //   break
      // }

      // If a new and final state
      if (id !== lastVisited) {
        // If it is not failed
        if (!followerElement.value.status.hasOwnProperty("error")) {
          history.push(followerElement.value);
        }
        lastVisited = id;
      }
    }
    count++;
  }
  await updateTable(
    "last_successful",
    { id: lastVisited },
    "all"
  );
  return history;
};

/**
 * Function to check if a round submission had already errored
 * @param {Number} round round for submission
 * @param {String} feed feed name
 * @returns {boolean} whether submission already errored
 */
export const submissionAlreadyErrored = async (round, feed) => {
  // Get offers
  let offers = await getOraclesInvitations(middlewareEnvInstance.FROM);

  // Check if invitation for feed exists
  if (!(feed in offers)) {
    logger.error(`Invitation for ${feed} not found in oracle invitations`);
    return new RoundDetails(1, 0, "", false, false);
  }

  // Get feed offer id
  let feedOfferId = offers[feed];

  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0], { retryCallback: null, jitter: null });

  const follower = await makeFollower(`:published.wallet.${middlewareEnvInstance.FROM}`, leader, {
    unserializer,
  });

  logger.info(`Checking invitations one by one for ${feed}`)

  let count = 0

  for await (const followerElement of iterateReverse(follower)) {

    count++;

    if (count > MAX_OFFERS_TO_LOOP){
      break
    }

    // If it is an offer status
    if (followerElement.value.updated === "offerStatus" && followerElement.value.status.invitationSpec.invitationMakerName == "PushPrice") {
      // Get id
      let id = followerElement.value.status.invitationSpec.previousOffer;
      let roundId = followerElement.value.status.invitationSpec.invitationArgs[0]["roundId"]
       
      // Break if round smaller
      if(id == feedOfferId && roundId < round){
        break
      }
      // If previous offer matches
      if (id == feedOfferId && roundId == round) {
        // If it failed
        if (followerElement.value.status.hasOwnProperty("error")) {
          logger.info(`Submission for round ${round} for ${feed} has error: ${followerElement.value.status.error}`)
          if (followerElement.value.status.error.includes("cannot report on previous rounds")) {

            let query = await queryTable("rounds", ["roundId"], feed);

            // If last submission is this round
            if (query.roundId == round) {
              logger.info(`Already errored in submission to round ${round} for feed ${feed}`)
              await updateTable(
                "rounds",
                { errored: true },
                feed
              );
            }

            return true
          }
        }
      }
    }
  }
  logger.info(`Finished checking invitations one by one for ${feed}`)

  return false;
};

/**
 * Function to get the latest submitted round
 * @param {string} oracle oracle address
 * @param {string} feedOfferId offer ID for feed
 * @returns {number} the latest round submitted
 */
export const getLatestSubmittedRound = async (oracle, feedOfferId) => {
  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0], {retryCallback: null, jitter: null});

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    unserializer,
  });

  // Get offers
  let offers = await getOffers(follower);

  for (let offer of offers){
    if (offer["status"]["invitationSpec"]["previousOffer"] == feedOfferId) {
      return Number(
        offer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
      );
    }
  }

  return 0;
};

/**
 * Function to check if a price submission was successful for a specific round
 * @param {string} oracle oracle address
 * @param {number} feedOfferId the offer id of the feed to check for
 * @param {number} roundId the round Id which is checked
 * @returns {boolean} whether a submission was successful for a specific round
 */
export const checkSubmissionForRound = async (oracle, feedOfferId, roundId) => {
  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0], {retryCallback: null, jitter: null});

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    unserializer,
  });

  // Get offers
  let offers = await getOffers(follower);
  logger.info(`Got ${offers.length} offers for ${feedOfferId} when checking submission for round`)

  // Loop through offers starting from last offer
  for (let i = 0; i < offers.length; i++) {
    // Get current offer
    let currentOffer = offers[i];

    // If a price invitation and for the correct feed
    let invitationType = currentOffer["status"]["invitationSpec"][
      "invitationMakerName"];
      
    let previousOffer = currentOffer["status"]["invitationSpec"][
      "previousOffer"];

    if (
      invitationType === "PushPrice" &&
      previousOffer === feedOfferId
    ) {
      let offerRound = Number(
        currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
      );

      /**
       * If it is an offer for the round we are checking for and there is no
       * error
       */
      if (
        offerRound === roundId &&
        !currentOffer["status"].hasOwnProperty("error")
      ) {
        return true;
      } else if (
        /**
         * If the currentOffer has no error and the offerRound is less than the
         * roundId, we return false since no new submissions for future rounds
         * can be created before completing the current round
         */
        offerRound < roundId &&
        !currentOffer["status"].hasOwnProperty("error")
      ) {
        return false;
      }
    }
  }
  logger.info(`Finished looping offers to check submissions for ${feedOfferId}`)
  return false;
};

/**
 * Function to query price from chain
 * @param {string} feed feed name of the price to query (Ex. ATOM-USD)
 * @returns {number} the latest price
 */
export const queryPrice = async (feed) => {
  try {
    // Read value from vstorage
    const capDataStr = await readVStorage(feed, false);
    let fromBoard = makeFromBoard();
    let capData = storageHelper.unserializeTxt(capDataStr, fromBoard).at(-1);

    // Get the latest price by dividing amountOut by amountIn
    let latestPrice =
      Number(capData.amountOut.value) /
      Number(capData.amountIn.value);

    logger.info(`${feed} Price Query: ${String(latestPrice)}`);
    return latestPrice;
  } catch (err) {
    logger.error(`ERROR querying price: ${feed}`);
    return -1;
  }
};

/**
 * Function to get oracles feed invitations
 * @param {string} oracle address of the oracle
 * @returns {object} an object containing feed invitation IDs. Each field in
 *                   the object represents the feed name (Ex. ATOM-USD) and its
 *                   value is a number which is the invitation ID.
 */
export const getOraclesInvitations = async (oracle) => {
  let { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });

  let feedBoards = agoricNames.reverse;

  let feedInvs = {};

  const current = await getCurrent(String(oracle), fromBoard, { vstorage });
  const liveOffers = current.liveOffers;
  const invitations = current.offerToUsedInvitation;

  // Loop through liveOffers and store the IDs in feedInvs
  let count = 0
  for (let inv in liveOffers) {
    let invitationId = liveOffers[inv][0]
    let invitationDetails = liveOffers[inv][1]
    //if there is a value
    if(invitationDetails.invitationSpec.hasOwnProperty("instance")){
      let boardId = invitationDetails.invitationSpec.instance.boardId;
      if(feedBoards[boardId]){
        logger.info(`Splitting ${feedBoards[boardId]} on price feed`)
        let feed = feedBoards[boardId].split(" price feed")[0];

        if(feed in feedsConfig.feeds){
          feedInvs[feed] = invitationId;
        }
  
      }
    }

    count++;
    if (count >= MAX_OFFERS_TO_LOOP){
      break
    }
  }

  // Loop through invitations and store the IDs in feedInvs
  count = 0
  for (let inv in invitations) {
    let invitationId = invitations[inv][0]
    let invitationDetails = invitations[inv][1]
    //if there is a value
    if(invitationDetails.value && invitationDetails.value.length > 0){
      let boardId = invitationDetails.value[0].instance.getBoardId();
      if(feedBoards[boardId]){
        let feed = feedBoards[boardId].split(" price feed")[0];
  
        let invDate = invitationId.split("oracleAccept-")[1]

        if(feed in feedsConfig.feeds){
          if(feedInvs[feed]){
            let currentDate = feedInvs[feed].split("oracleAccept-")[1]
            if (Number(invDate) > Number(currentDate)){
              feedInvs[feed] = invitationId;
            }
          }
          else{
            feedInvs[feed] = invitationId;
          }
        }
      }
    }

    count++;
    if (count >= MAX_OFFERS_TO_LOOP){
      break
    }
  }

  logger.info(`Feed invitations ${JSON.stringify(feedInvs)}`)

  return feedInvs;
};

/**
 * Function to query round from chain
 * @param {string} feed feed name of the price to query (Ex. ATOM-USD)
 * @param {string} oracle address of oracle to check for submission
 * @param {boolean} checkSubmission whether to check for submission
 * @returns {RoundDetails} the latest round
 */
export const queryRound = async (feed, oracle, checkSubmission) => {
  // Read value from vstorage
  let capData;

  try {
    const capDataStr = await readVStorage(feed, true);
    let fromBoard = makeFromBoard();
    capData = storageHelper.unserializeTxt(capDataStr, fromBoard).at(-1);
  } catch (err) {
    logger.error(`Failed to parse CapData for queryRound for ${feed}: ${err}`);
    return new RoundDetails(1, 0, "", false, true);
  }

  // Get round from result
  let round = Number(capData.roundId);
  logger.info(`Latest Round from chain for ${feed}: ${round}`)

  let submissionForRound = false
  let query = await queryTable("rounds", ["roundId", "submissionMade", "errored"], feed);
  if(checkSubmission){
    // Get offers
    let offers = await getOraclesInvitations(oracle);

    // Check if invitation for feed exists
    if (!(feed in offers)) {
      logger.error(`Invitation for ${feed} not found in oracle invitations`);
      return new RoundDetails(1, 0, "", false, true);
    }

    // Get feed offer id
    let feedOfferId = offers[feed];

    // Check if there is a submission for round
    submissionForRound = await checkSubmissionForRound(
      oracle,
      feedOfferId,
      round
    );
    logger.info(`Submission for round ${round} for feed ${feed} found in offers: ${submissionForRound}`)
    logger.info(`Submission for round ${round} for feed ${feed} found in DB: ${(query.roundId == round && query.submissionMade == 1)}. Last round found in DB was ${round}`)
    submissionForRound = submissionForRound || (query.roundId == round && query.submissionMade == 1)
  }

  
  // Get the latest round
  let latestRound = new RoundDetails(
    round,
    Number(capData.startedAt.absValue),
    capData.startedBy,
    submissionForRound,
    (query.roundId == round && query.errored == 1)
  );

  if(checkSubmission){
    logger.info(`${feed} Latest Round: ${latestRound.roundId}. Submitted: ${submissionForRound}`);
  } else{
    logger.info(`${feed} Latest Round: ${latestRound.roundId}`);
  }

  return latestRound;
};

/** @param {import('../lib/psm.js').BridgeAction} bridgeAction */
export const outputAction = (bridgeAction) => {
  return marshaller.serialize(harden(bridgeAction));
};

/**
 * Function to push price on chain to the smart wallet
 * @param {number} price price to push
 * @param {string} feed feed to push price to (Ex. ATOM-USD)
 * @param {number} round round to push result to
 * @param {string} from account to push from
 * @returns {boolean} whether successful
 */
export const pushPrice = async (price, feed, round, from) => {
  // Get offers
  let offers = await getOraclesInvitations(from);
  logger.info(`In Pushing price for ${feed} for round ${round}`)

  // Check if invitation for feed exists
  if (!(feed in offers)) {
    throw new Error(`Invitation for ${feed} not found in oracle invitations`);
  }

  // Get previous offer for feed
  let previousOffer = offers[feed];

  // Create an offer
  let templateOffer = {
    invitationSpec: {
      source: "continuing",
      previousOffer: previousOffer,
      invitationMakerName: "PushPrice",
      invitationArgs: harden([{ unitPrice: BigInt(price), roundId: round }]),
    },
    proposal: {},
  };

  // Create keyring
  let keyring = {
    home: "",
    backend: "test",
  };

  // Check if submitted for round
  let submitted = await checkSubmissionForRound(from, previousOffer, round);
  logger.info(`Finished checking if already submitted to round ${round} for feed ${feed}`)

  // Check if in submission
  let inSubmission = await checkIfInSubmission(feed);
  logger.info(`Finished checking if already in submission to round ${round} for feed ${feed}`)

  logger.info(`In Pushing price for ${feed} for round ${round} -> submitted: ${submitted}, inSubmission: ${inSubmission}`)

  // Loop retries
  for (
    let i = 0;
    i < middlewareEnvInstance.SUBMIT_RETRIES && !submitted && !inSubmission;
    i++
  ) {
    // Query round
    let latestRound = await queryRound(feed, from, true);

    // Check if failed
    if(latestRound.startedAt == 0 && !latestRound.submitted){
      logger.info(`Aborting submission to round ${round} for feed ${feed} due to failed round query`)
      continue;
    }

    /**
     * If latestRound is greater than round being pushed or submission to the
     * round is already made, abort
     */
    let latestRoundGreater = latestRound.roundId > round;
    let submissionAlreadyMade =
      latestRound.roundId === round && latestRound.submissionMade;
    logger.info(`Feed ${feed}: latestRoundGreater: ${latestRoundGreater} -> Submitting to ${round}, Latest round ${latestRound.roundId}`)
    logger.info(`Feed ${feed}: submissionAlreadyMade: ${submissionAlreadyMade}`)
    if (latestRoundGreater || submissionAlreadyMade) {
      logger.info(`Price failed to be submitted for old round ${round} for feed ${feed}`);
      return false;
    }

    logger.info(`Submitting price for round ${round} for feed ${feed} attempt ${i + 1}`);

    let offer = {...templateOffer};
    offer.id = Number(Date.now());

    // Output action
    let data = outputAction({
      method: "executeOffer",
      offer,
    });

    // Get latest sequence number
    let sequence = await getNextSequence();

    // Get last submission block
    const query = await queryTable("jobs", ["last_submitted_block", "last_tried_round"], feed);
    const lastSubmissionBlock = Number(query.last_submitted_block)
    const lastTriedRound = Number(query.last_tried_round)

    // Get latest block height
    let rpcState = await getLatestBlockHeight();
    let latestHeight = rpcState.height
    let rpcStillSyncing = rpcState.syncing

    // submit update only if height increased or a new round from last submit
    logger.info(`Checking whether to submit for round ${round}. Last submitted on block ${lastSubmissionBlock} and current height is ${latestHeight} for round ${lastTriedRound} for feed ${feed}. Block lock is set to ${middlewareEnvInstance.SUBMISSION_BLOCK_LOCK}`)
    const allowedSubmissionHeight = lastSubmissionBlock + Number(middlewareEnvInstance.SUBMISSION_BLOCK_LOCK)
    const sameRound = lastTriedRound == round
    const newRound = round > lastTriedRound
    /**
     * If same round as last tried but enough blocks passed OR
     * If new round and latest height is greater than the height of latest submission OR
     * If the round is smaller than the last tried round or the round is 0 or 1 (In case of retriggered invitations)
     * AND the rpc is not still syncing
     */
    let sameRoundEnoughBlocksPassed = latestHeight > allowedSubmissionHeight && sameRound
    let newRoundEnoughBlocksPassed = newRound && latestHeight > lastSubmissionBlock
    let retriggeredInvitation =  (latestHeight > allowedSubmissionHeight && round < lastTriedRound && (latestRound.roundId == round || latestRound.roundId == 0 || round == 1))
    logger.info(`Final check when submitting for round ${round} for feed ${feed}. sameRoundEnoughBlocksPassed -> ${sameRoundEnoughBlocksPassed}, newRoundEnoughBlocksPassed -> ${newRoundEnoughBlocksPassed}, retriggeredInvitation -> ${retriggeredInvitation}, rpcStillSyncing -> ${rpcStillSyncing}`)
    if ((sameRoundEnoughBlocksPassed || newRoundEnoughBlocksPassed || retriggeredInvitation) && !rpcStillSyncing){
      // Execute
      try{
        // Update last submitted block height
        await updateTable(
          "jobs",
          { 
            last_submitted_block: latestHeight,
          },
          feed
        );
        
        logger.info(`Executing AGD for round ${round} for feed ${feed}.`)
        let response = await execSwingsetTransaction(
          "wallet-action --allow-spend '" + JSON.stringify(data) + "' --gas-prices=0.01ubld --offline --account-number=" + middlewareEnvInstance.ACCOUNT_NUMBER + " --sequence=" + sequence["next_num"],
          //"wallet-action --allow-spend '" + JSON.stringify(data) + "' --gas-prices=0.01ubld",
          networkConfig,
          from,
          false,
          keyring
        );

        logger.info("Response: "+JSON.stringify(response))

        // If transaction failed
        if(response["code"] != 0){
          // Get raw log
          let rawLog = response["raw_log"];
          // If error contains sequence mismatch
          if (rawLog.includes("incorrect account sequence")){
            // setSequence
            const regex = /\d+/g;
            const numbers = rawLog.match(regex);
            logger.info(`Setting sequence to ${numbers[0]}`)
            await setSequenceNumber(numbers[0])
          }

        } else {
          // Update sequence
          logger.info(`Increment sequence to ${sequence["next_num"]+1}`)
          await incrementSequence();

          // Update last submission time
          await updateTable(
            "jobs",
            { 
              last_submission_time: Date.now() / 1000,
              last_tried_round: round
            },
            feed
          );
        }
      }
      catch(error){
        // If tx failed to be included (timeout)
        if (String(error).includes("timed out waiting for tx to be included in a block")){
          // Update sequence
          logger.info(`Increment sequence to ${sequence["next_num"]+1}`)
          await incrementSequence();
        }
      }

      rpcState = await getLatestBlockHeight();
      latestHeight = rpcState.height
      rpcStillSyncing = rpcState.syncing
      logger.info(`RPC Latest block height ${latestHeight}, still syncing -> ${rpcStillSyncing}`);
    }
    else{
      logger.info(`Already submitted to round in block ${latestHeight} for feed ${feed}`);

      if(rpcStillSyncing){
        logger.info(`RPC is out of sync, will not be submitting for feed ${feed}`)
      }
    }

    // Sleep SEND_CHECK_INTERVAL seconds
    await delay((Number(middlewareEnvInstance.SEND_CHECK_INTERVAL) + 1) * 1000);

    // Check submission for round
    submitted = await checkSubmissionForRound(from, previousOffer, round);

    // Check if in submission
    inSubmission = await checkIfInSubmission(feed);
  }

  if (submitted) {
    logger.info("Price submitted successfully for round " + round);
  } else {
    logger.error("Price failed to be submitted for round " + round);
  }

  return submitted;
};

/**
 * Function to get offers and balances
 * @param {Promise<import('@agoric/casting/src/follower-cosmjs').
 * ValueFollower<T>>} follower offers and balances
 * @param {string} oracle oracle address
 * @returns {object} an object containing the offers and balances
 * @returns {object[]} returns.offers Array of offers
 * @returns {object[]} returns.balances Array of balances
 */
export const getOffersAndBalances = async (follower, oracle) => {
  let toReturn = {
    offers: await getOffers(follower),
    balances: [],
  };

  // Get balances
  let balances = JSON.parse(execSync(`agd query --node ${networkConfig.rpcAddrs[0]} bank balances ${oracle} --output=json`).toString()).balances;

  for (let i = 0; i < balances.length; i++) {
    toReturn["balances"].push(balances[i]);
  }

  return toReturn;
};

/**
 * Function to get the amount in of a feed
 * @param {string} feed feed name like ATOM-USD
 * @returns {number} the amount in for the feed
 */
export const getAmountsIn = async (feed) => {
  const capDataStr = await readVStorage(feed, false);

  // Parse the value
  let fromBoard = makeFromBoard();
  let capData = storageHelper.unserializeTxt(capDataStr, fromBoard).at(-1);

  return Number(capData.amountIn.value);
};

/**
 * Function to get the latest info for an oracle
 * @param {string} oracle oracle address
 * @param {object} oracleDetails oracle details
 * @param {object} state oracle's latest state
 * @param {MonitorMetrics} metrics MonitorMetrics instance
 * @param {object} amountIn this contains the amountIn for each feed. The feed 
 *                 name is the field and the value is the amountIn value
 * @returns {object} last results including the oracle submitted price
 */
export const getOracleLatestInfo = async (
  oracle,
  oracleDetails,
  state,
  metrics,
  amountsIn
) => {
  // Get feeds for oracle
  let feeds = oracleDetails["feeds"];
  logger.info(`Getting prices for ${oracleDetails["oracleName"]} ${oracle} - ${JSON.stringify(feeds)}`);

  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    unserializer,
  });

  let offersBalances = await getOffersAndBalances(follower, oracle);
  logger.info(`Obtained offers and balances for ${oracleDetails["oracleName"]}`)

  // Get last offer id from offers from state
  let lastOfferId = isNaN(state["last_index"]) ? 0 : state["last_index"];

  // Initialise variable to hold results
  let lastResults = {
    last_index: lastOfferId,
    values: state["values"] ? state["values"] : {},
  };
  logger.info(`Going through offers and balances for ${oracleDetails["oracleName"]}`)

  // Loop through offers starting from last visited index
  for (let i = 0; i < offersBalances.offers.length; i++) {
    // Get current offer
    let currentOffer = offersBalances.offers[i];

    let id = Number(currentOffer["status"]["id"]);

    // If a number
    if (!isNaN(id)) {

      // If a price invitation
      let invMakerName =
        currentOffer["status"]["invitationSpec"]["invitationMakerName"];

      if (invMakerName === "PushPrice") {
        let feed =
          feeds[currentOffer["status"]["invitationSpec"]["previousOffer"]];
        let lastRound = Number(
          currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
        );

        if(feed){

          // Get feeds' last observed round from state
          let lastObservedRound = state["values"].hasOwnProperty(feed) && state["values"][feed].hasOwnProperty("round")
            ? state["values"][feed]["round"]
            : 0;

          logger.info(`Found Push Price for ${oracleDetails["oracleName"]} for ${feed} on round ${lastRound}. Last observed round: ${lastObservedRound}`)
          // If round is bigger than last observed and the offer didn't fail
          if (
            lastRound >= lastObservedRound &&
            !currentOffer["status"].hasOwnProperty("error")
          ) {
            // If id is bigger than last offer id in state, set it
            lastResults["last_index"] = id;
            lastOfferId = id;
  
            // Get latest round
            let latestRound = await queryRound(feed, oracle, false);
  
            // Get current rounds created
            let roundsCreated =
              state["values"].hasOwnProperty(feed) &&
                state["values"][feed].hasOwnProperty("rounds_created")
                ? state["values"][feed]["rounds_created"]
                : 0;
  
            // If oracle is the new round's creator, increment rounds created
            if (latestRound.startedBy == oracle) {
              roundsCreated++;
            }
  
            let price =
              Number(
                currentOffer["status"]["invitationSpec"]["invitationArgs"][0][
                "unitPrice"
                ]
              ) / amountsIn[feed];
  
            // Fill results variable
            lastResults["values"][feed] = {
              price: price,
              id: id,
              round: lastRound,
              rounds_created: roundsCreated
            };
            state = lastResults;
  
            // Get latest feed price
            let feedPrice = await queryPrice(feed);
  
            logger.info(`Updating metrics for ${oracleDetails["oracleName"]} for ${feed} @ round ${lastRound}`);
  
            // Update metrics
            metrics.updateMetrics(
              oracleDetails["oracleName"],
              oracle,
              feed,
              price,
              id,
              feedPrice,
              lastRound,
              roundsCreated
            );
          }
        }

        
      }
    }
  }

  /**
   * Loop through balances and add only IST and BLD balances for monitoring
   * because we are only interested in those for the oracle network
   */
  for (let i = 0; i < offersBalances.balances.length; i++) {
    let currentBalance = offersBalances.balances[i];

    let brand = currentBalance.denom;
    if (brand.includes("bld") || brand.includes("ist")) {
      let value = Number(currentBalance.amount);
      metrics.updateBalanceMetrics(
        oracleDetails["oracleName"],
        oracle,
        brand,
        value
      );
    }
  }

  return lastResults["last_index"] !== lastOfferId ? lastResults : state;
};