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
  makeFromBoard,
  makeVStorage,
} from "../lib/rpc.js";
import { getCurrent } from "../lib/wallet.js";
import { execSwingsetTransaction } from "../lib/chain.js";
import { 
    checkIfInSubmission, 
    delay 
} from "./utils.js";
import { updateTable } from "./db.js";

const { FROM, SUBMIT_RETRIES = "3", SEND_CHECK_INTERVAL = "45" } = process.env;

if (process.env.NODE_ENV !== "test") {
  assert(FROM, "$FROM is required");
  assert(Number(SUBMIT_RETRIES), "$SUBMIT_RETRIES is required");
  assert(Number(SEND_CHECK_INTERVAL), "$SEND_CHECK_INTERVAL is required");
}

const marshaller = boardSlottingMarshaller();

/**
 * Function to read from vstorage
 * @param {string} feed the feed to read
 * @param {boolean} roundData whether to read round data or price data
 * @returns {string} CapData of result
 */
export const readVStorage = async (feed, roundData) => {
  const vstorage = makeVStorage({ fetch });
  let key = roundData
    ? "published.priceFeed." + feed + "_price_feed.latestRound"
    : "published.priceFeed." + feed + "_price_feed";
  return await vstorage.readLatest(key);
};

/**
 * Function to get last 5 offers
 * @param {Promise<import('@agoric/casting/src/follower-cosmjs').ValueFollower<T>>} follower offers and balances
 * @returns {string} a list of offers
 */
export const getOffers = async (follower) => {
  let history = [];
  let lastVisited = -1;

  for await (const followerElement of iterateReverse(follower)) {
    if (history.length === 5) {
      break;
    }

    // If it is an offer status
    if (followerElement.value.updated === "offerStatus") {
      // Get id
      let id = followerElement.value.status.id;

      // If a new and final state
      if (id !== lastVisited) {
        // If it is not failed
        if (!followerElement.value.status.hasOwnProperty("error")) {
          history.push(followerElement.value);
        }
        lastVisited = id;
      }
    }
  }
  return history;
};

/**
 * Function to get the latest submitted round
 * @param {string} oracle oracle address
 * @returns {number} the latest round submitted
 */
export const getLatestSubmittedRound = async (oracle) => {
  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    // @ts-expect-error xxx
    unserializer,
  });

  // Get offers
  let offers = await getOffers(follower);

  return Number(
    offers[0]["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
  );
};

/**
 * Function to check if submission was satisfied for a specific round
 * @param {string} oracle oracle address
 * @param {number} feedOfferId the offer id of the feed to check for
 * @param {number} roundId the round Id which is checked
 * @returns {boolean} whether a submission was successful for a specific round
 */
export const checkSubmissionForRound = async (oracle, feedOfferId, roundId) => {
  let fromBoard = makeFromBoard();
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    // @ts-expect-error xxx
    unserializer,
  });

  // Get offers
  let offers = await getOffers(follower);

  // Loop through offers starting from last offer
  for (let i = 0; i < offers.length; i++) {
    // Get current offer
    let currentOffer = offers[i];

    // If a price invitation and for the correct feed
    let invitationType = currentOffer["status"]["invitationSpec"]["invitationMakerName"];
    let previousOffer = currentOffer["status"]["invitationSpec"]["previousOffer"]
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
         * Else if offer round id is less than the round we want to check and
         * its satisfied
         */
        offerRound < roundId &&
        !currentOffer["status"].hasOwnProperty("error")
      ) {
        /**
         * Return false because there cannot be a submission for a newer round
         * before this offer
         */
        return false;
      }
    }
  }
  return false;
};

/**
 * Function to query price from chain
 * @param {string} feed feed name of the price to query in the form of ATOM-USD
 * @returns {number} the latest price
 */
export const queryPrice = async (feed) => {
  try {
    // Read value from vstorage
    const capDataStr = await readVStorage(feed, false);

    //parse the value
    let capData = JSON.parse(JSON.parse(capDataStr).value);
    capData = JSON.parse(capData.values[0]);
    // Replace any extra characters
    capData = JSON.parse(capData.body.replaceAll("\\", ""));

    // Get the latest price by dividing amountOut by amountIn
    let latestPrice =
      Number(capData.amountOut.value.digits) /
      Number(capData.amountIn.value.digits);

    console.log(feed + " Price Query: " + String(latestPrice));
    return latestPrice;
  } catch (err) {
    console.log("ERROR querying price", err);
    return -1;
  }
};

/**
 * Function to get oracles feed invitations
 * @returns {Object} an object containing feed invitation IDs. Each field in *                   the object represents the feed name (Ex. ATOM-USD) and its *                   value is a number * where which is the invitation ID.
 */
export const getOraclesInvitations = async () => {
  let { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });

  let feedBoards = agoricNames.reverse;

  let feedInvs = {};

  const current = await getCurrent(String(FROM), fromBoard, { vstorage });
  const invitations = current.offerToUsedInvitation;

  // For each invitation
  for (let inv in invitations) {
    let boardId = invitations[inv].value[0].instance.boardId;
    let feed = feedBoards[boardId].split(" price feed")[0];

    feedInvs[feed] = Number(inv);
  }

  return feedInvs;
};

/**
 * Function to query round from chain
 * @param {string} feed feed name of the price to query in the form of ATOM-USD
 * @returns {Object} the latest round
 * @returns {number} returns.round_id The round id
 * @returns {number} returns.started_at The timestamp when the round *                   was started
 * @returns {string} returns.started_by The address of who started the round
 * @returns {boolean} returns.submission_made Whether a submission to this *                    round was made by the oracle
 */
export const queryRound = async (feed) => {
  // Read value from vstorage
  const capDataStr = await readVStorage(feed, true);

  //parse the value
  let capData = JSON.parse(JSON.parse(capDataStr).value);
  capData = JSON.parse(capData.values[capData.values.length - 1]);
  // Replace any extra characters
  capData = JSON.parse(capData.body.replaceAll("\\", ""));

  // Get round from result
  let round = Number(capData.roundId.digits);

  // Get offers
  let offers = await getOraclesInvitations();
  // Get feed offer id
  let feedOfferId = offers[feed];

  // Check if there is a submission for round
  let submissionForRound = await checkSubmissionForRound(
    FROM,
    feedOfferId,
    round
  );

  // Get the latest round
  let latestRound = {
    round_id: round,
    started_at: Number(capData.startedAt.digits),
    started_by: capData.startedBy,
    submission_made: submissionForRound,
  };

  console.log(feed + " Latest Round: ", latestRound.round_id);
  return latestRound;
};

/** @param {import('../lib/psm.js').BridgeAction} bridgeAction */
export const outputAction = (bridgeAction) => {
  const capData = marshaller.serialize(bridgeAction);
  return JSON.stringify(capData);
};

/**
 * Function to push price on chain to the smart wallet
 * @param {number} price price to push
 * @param {string} feed feed to push price to
 * @param {number} round round to push result to
 * @param {string} from account to push from
 * @returns {boolean} whether successful
 */
export const pushPrice = async (price, feed, round, from) => {
  // Create an offerId with the Date number
  let offerId = Date.now();

  // Get offers
  let offers = await getOraclesInvitations();
  // Get previous offer for feed
  let previousOffer = offers[feed];

  // Create an offer
  const offer = {
    id: Number(offerId),
    invitationSpec: {
      source: "continuing",
      previousOffer: Number(previousOffer),
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

  // Check if in submission
  let inSubmission = await checkIfInSubmission(feed);

  // Loop retries
  for (let i = 0; i < SUBMIT_RETRIES && !submitted && !inSubmission; i++) {
    // Query round
    let latestRound = await queryRound(feed);

    /**
     * If latestRound is greater than round being pushed or submission to the
     * round is already made, abort
     */
    let latestRoundGreater = latestRound.round_id > round;
    let submissionAlreadyMade =
      latestRound.round_id === round && latestRound.submission_made;
    if (latestRoundGreater || submissionAlreadyMade) {
      console.log("Price failed to be submitted for old round", round);
      return false;
    }

    console.log("Submitting price for round", round, "attempt", i + 1);

    offer.id = Number(Date.now());

    // Output action
    let data = outputAction({
      method: "executeOffer",
      // @ts-ignore
      offer,
    });

    // Change data to JSON
    data = JSON.parse(data);

    // Execute
    await execSwingsetTransaction(
      "wallet-action --allow-spend '" + JSON.stringify(data) + "'",
      networkConfig,
      from,
      false,
      keyring
    );

    // Update last submission time
    await updateTable(
      "jobs",
      { last_submission_time: Date.now() / 1000 },
      "feed"
    );

    // Sleep 13 seconds to wait 2 blocks and a bit
    await delay((Number(SEND_CHECK_INTERVAL) + 1) * 1000);

    // Check submission for round
    submitted = await checkSubmissionForRound(from, previousOffer, round);

    // Check if in submission
    inSubmission = await checkIfInSubmission(feed);
  }

  if (submitted) {
    console.log("Price submitted successfully for round", round);
  } else {
    console.log("Price failed to be submitted for round", round);
  }

  return submitted;
};
