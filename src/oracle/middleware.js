// @ts-nocheck
/* eslint-disable func-names */
/* global fetch, process */

/**
 * IMPORTS
 */
import { execSwingsetTransaction } from "../lib/chain.js";
import {
  makeRpcUtils,
  boardSlottingMarshaller,
  networkConfig,
  makeAgoricNames,
} from "../lib/rpc.js";
import axios from "axios";
import http from "http";
import fs from "fs";
import { getCurrent } from "../lib/wallet.js";
import bodyParser from "body-parser";
import express from "express";
import {
  validUrl,
  delay,
  readJSONFile,
  readVStorage,
} from "../helpers/utils.js";
import { makeFollower, makeLeader } from "@agoric/casting";
import { iterateReverse } from "@agoric/casting";
import {
  getAllJobs,
  createDBs,
  createJob,
  deleteJob,
  queryTable,
  updateTable,
} from "../helpers/db.js";

// get environment variables
const {
  PORT = "3000",
  EI_CHAINLINKURL,
  FROM,
  SUBMIT_RETRIES = 3,
  BLOCK_INTERVAL = "6",
  SEND_CHECK_INTERVAL = "45",
  AGORIC_RPC = "http://0.0.0.0:26657",
  STATE_FILE = "data/middleware_state.json",
  CREDENTIALS_FILE = "config/ei_credentials.json",
  OFFERS_FILE = "config/offers.json",
  FEEDS_FILE = "oracle/feeds.json",
} = process.env;

/**
 * Environment variables validation
 */
if (process.env.NODE_ENV != "test") {
  assert(EI_CHAINLINKURL, "$EI_CHAINLINKURL is required");
  assert(Number(SUBMIT_RETRIES), "$SUBMIT_RETRIES is required");
  assert(FROM, "$FROM is required");
  assert(validUrl(AGORIC_RPC), "$AGORIC_RPC is required");
  assert(STATE_FILE != "", "$STATE_FILE is required");
  assert(CREDENTIALS_FILE != "", "$CREDENTIALS_FILE is required");
  assert(OFFERS_FILE != "", "$OFFERS_FILE is required");
  assert(FEEDS_FILE != "", "$FEEDS_FILE is required");
}

var agoricNames = {};
var fromBoard = {};
var vstorage = {};
const marshaller = boardSlottingMarshaller();

var credentials;
var feeds;

/**
 * Function to initialise state
 */
const initialiseState = async () => {
  //create tables if they do not exist
  await createDBs();
};

/**
 * Function to send a job run to the CL node
 * @param {*} credentials the external initiator credentials
 * @param {*} count the request id
 * @param {*} jobId the Chainlink external job id
 * @param {*} chainlinkUrl the Chainlink node url where to send the job request
 * @param {*} requestType the request type, 1 = time, 2 = deviation, 3 = new 
 *                        round
 */
const sendJobRun = async (
  credentials,
  count,
  jobId,
  chainlinkUrl,
  requestType
) => {
  const options = {
    url: chainlinkUrl + "/v2/jobs/" + jobId + "/runs",
    body: {
      payment: 0,
      request_id: count,
      request_type: requestType,
    },
    headers: {
      "Content-Type": "application/json",
      "X-Chainlink-EA-AccessKey": credentials["EI_IC_ACCESSKEY"],
      "X-Chainlink-EA-Secret": credentials["EI_IC_SECRET"],
    },
    method: "POST",
  };

  //try request with loop retries
  for (let i = 0; i < SUBMIT_RETRIES; i++) {
    try {
      await axios.post(options.url, options.body, {
        timeout: 60000,
        proxy: false,
        headers: options.headers,
        httpAgent: new http.Agent({ keepAlive: false }),
      });
      return;
    } catch (err) {
      console.error("JOB Request for " + jobId + " failed", err);
    }
  }
};

/**
 * Function to get last 10 offers
 * @param {*} follower offers and balances
 * @returns a list of offers
 */
export const getOffers = async (follower) => {
  let history = [];
  let counter = 0;
  let lastVisited = 0;

  for await (const followerElement of iterateReverse(follower)) {
    if (counter == 5) {
      break;
    }

    //if it is an offer status
    if (followerElement.value.updated == "offerStatus") {
      //get id
      let id = followerElement.value.status.id;

      //if a new and final state
      if (id != lastVisited) {
        //if it is not failed
        if (!followerElement.value.status.hasOwnProperty("error")) {
          history.push(followerElement.value);
          counter++;
        }
        lastVisited = id;
      }
    }
  }
  return history;
};

/**
 * Function to get the latest submitted round
 * @returns the latest round submitted
 */
export const getLatestSubmittedRound = async () => {
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${FROM}`, leader, {
    // @ts-expect-error xxx
    unserializer,
  });

  //get offers
  let offers = await getOffers(follower);

  return Number(
    offers[0]["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
  );
};

/**
 * Function to check if submission was satisfied for a specific round
 * @param {*} oracle oracle address
 * @param {*} feedOfferId the offer id of the feed to check for
 * @param {*} roundId the round Id which is checked
 * @returns whether a submission was successful for a specific round
 */
export const checkSubmissionForRound = async (oracle, feedOfferId, roundId) => {
  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    // @ts-expect-error xxx
    unserializer,
  });

  //get offers
  let offers = await getOffers(follower);

  //loop through offers starting from last offer
  for (var i = 0; i < offers.length; i++) {
    //get current offer
    var currentOffer = offers[i];

    //if a price invitation and for the correct feed
    if (
      currentOffer["status"]["invitationSpec"]["invitationMakerName"] ==
        "PushPrice" &&
      currentOffer["status"]["invitationSpec"]["previousOffer"] == feedOfferId
    ) {
      let offerRound = Number(
        currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
      );

      //if it is an offer for the round we are checking for
      if (offerRound == roundId) {
        //if there is no error
        if (!currentOffer["status"].hasOwnProperty("error")) {
          return true;
        }
      }

      /**
       * else if offer round id is less than the round we want to check and 
       * its satisfied
       */
      else if (
        offerRound < roundId &&
        !currentOffer["status"].hasOwnProperty("error")
      ) {
        /**
         * return false because there cannot be a submission for a newer round 
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
 * @param {*} feed feed name of the price to query in the form of ATOM-USD
 * @returns the latest price
 */
export const queryPrice = async (feed) => {
  try {
    //read value from vstorage
    const capDataStr = await readVStorage(vstorage, feed, false);

    //parse the value
    var capData = JSON.parse(JSON.parse(capDataStr).value);
    capData = JSON.parse(capData.values[0]);
    //replace any extra characters
    capData = JSON.parse(capData.body.replaceAll("\\", ""));

    //get the latest price by dividing amountOut by amountIn
    var latestPrice =
      Number(capData.amountOut.value.digits) /
      Number(capData.amountIn.value.digits);

    console.log(feed + " Price Query: " + String(latestPrice));
    return latestPrice;
  } catch {
    return 0;
  }
};

/**
 * Function to get oracles feed invitations
 * @returns an object containing feed invitation IDs
 */
export const getOraclesInvitations = async () => {
  //if agoric names do not exist, create them
  if (Object.keys(agoricNames).length == 0) {
    agoricNames = await makeAgoricNames(fromBoard, vstorage);
  }

  let feedBoards = agoricNames.reverse;

  let feedInvs = {};

  const current = await getCurrent(String(FROM), fromBoard, { vstorage });
  const invitations = current.offerToUsedInvitation;

  //for each invitation
  for (let inv in invitations) {
    let boardId = invitations[inv].value[0].instance.boardId;
    let feed = feedBoards[boardId].split(" price feed")[0];

    feedInvs[feed] = Number(inv);
  }

  return feedInvs;
};

/**
 * Function to query round from chain
 * @param {*} feed feed name of the price to query in the form of ATOM-USD
 * @returns the latest round
 */
export const queryRound = async (feed) => {
  //read value from vstorage
  const capDataStr = await readVStorage(vstorage, feed, true);

  //parse the value
  var capData = JSON.parse(JSON.parse(capDataStr).value);
  capData = JSON.parse(capData.values[capData.values.length - 1]);
  //replace any extra characters
  capData = JSON.parse(capData.body.replaceAll("\\", ""));

  //get round from result
  let round = Number(capData.roundId.digits);

  //get offers
  let offers = await getOraclesInvitations();
  //get feed offer id
  let feedOfferId = offers[feed];

  //check if there is a submission for round
  let submissionForRound = await checkSubmissionForRound(
    FROM,
    feedOfferId,
    round
  );

  //get the latest round
  var latestRound = {
    round_id: round,
    started_at: Number(capData.startedAt.digits),
    started_by: capData.startedBy,
    submission_made: submissionForRound,
  };

  console.log(feed + " Latest Round: ", latestRound.round_id);
  return latestRound;
};

/**
 * Function to submit a new job run to the Chainlink node
 * @param {*} feed the feed to submit a job for
 * @param {*} requestType the request type to send as a parameter with 
 *                        the job request. 1 if a timer request, 2 if triggered
 *                        by a price deviation, 3 new round.
 */
const submitNewJob = async (feed, requestType) => {
  //get latest request id
  let query = await queryTable("jobs", ["request_id", "id"], feed);
  let newRequestId = query.request_id + 1;
  //update table
  await updateTable(
    "jobs",
    { request_id: newRequestId, last_request_sent: Date.now() / 1000 },
    feed
  );

  console.log("Sending job spec", feed, "request", newRequestId);

  //send job run
  await sendJobRun(
    credentials,
    newRequestId,
    query.id,
    EI_CHAINLINKURL,
    requestType
  );
};

/**
 * Controller for the middleware
 */
const makeController = () => {
  const oneSecInterval = 1 * 1_000;

  //create an interval which creates a job request every second
  const it = setInterval(async () => {
    //get all jobs
    let jobs = await getAllJobs();

    //for each job in state, send a job run
    jobs.forEach(async (job) => {
      //get interval for feed
      let feedName = job.name;
      let pollInterval = feeds[feedName].pollInterval;

      //check whether poll interval expired
      let now = Date.now() / 1000;
      let query = await queryTable("jobs", ["last_request_sent"], feedName);
      let timeForPoll = query.last_request_sent + pollInterval <= now;

      //if interval expired
      if (timeForPoll) {
        /**
         * send a job run with type 1, indicating a job run triggered from 
         * the polling interval
         */
        await submitNewJob(feedName, 1);
      }
    });
  }, oneSecInterval);

  const priceQueryInterval = parseInt(BLOCK_INTERVAL, 10);
  //validate polling interval
  assert(
    !isNaN(priceQueryInterval),
    `$BLOCK_INTERVAL ${BLOCK_INTERVAL} must be a number`
  );

  /**
   * create an interval which query the price and creates a chainlink job 
   * request if the price deviates more than a specific threshold
   */
  const it2 = setInterval(async () => {
    //get all jobs
    let jobs = await getAllJobs();

    //for each job
    for (var i = 0; i < jobs.length; i++) {
      //get the job name
      let jobName = jobs[i].name;

      let sendRequest = 0;

      //query the price
      let latestPrice = await queryPrice(jobName);

      //get latest price
      let query = await queryTable("jobs", ["last_result"], jobName);
      let currentPrice = query.last_result;

      //query latest round
      let latestRound = await queryRound(jobName);

      //get latest submitted round
      var latestSubmittedRound = await getLatestSubmittedRound();

      //update jobs table
      await updateTable(
        "jobs",
        {
          last_result: latestPrice,
          last_reported_round: latestSubmittedRound,
        },
        jobName
      );

      //update rounds table
      await updateTable("rounds", latestRound, jobName);

      //if latest round is bigger than last reported round
      if (latestRound.round_id > latestSubmittedRound) {
        //if submitted, update last_reported_round
        if (latestRound.submission_made) {
          await updateTable(
            "jobs",
            { last_reported_round: latestSubmittedRound },
            jobName
          );
        }
        //if not found send job request
        else {
          console.log("Found new round.");
          sendRequest = 3;
        }
      }

      //if there's a price deviation
      let priceDev =
        Math.abs((latestPrice - currentPrice) / currentPrice) * 100;

      if (priceDev > 0) {
        console.log(
          "Found a price deviation for",
          jobName,
          "of",
          priceDev,
          "%. Latest price:",
          latestPrice,
          " Current Price:",
          currentPrice
        );
      }

      //get feed deviation percentage threshold
      let priceDeviationPercentage = feeds[jobName].priceDeviationPerc;
      if (priceDev > priceDeviationPercentage) {
        sendRequest = 2;
      }

      //if there is a request to be sent
      if (sendRequest != 0) {
        //get seconds now
        let secondsNow = Date.now() / 1000;
        //check seconds passed from last request
        let query = await queryTable("jobs", ["last_request_sent"], jobName);
        let secondsPassed = secondsNow - query.last_request_sent;

        /**
         * check if allowed to send - 45 seconds passed or a request 
         * has not been made.
         */
        query = await queryTable(
          "jobs",
          ["last_received_request_id", "request_id"],
          jobName
        );
        let allowedSend =
          query.request_id == query.last_received_request_id ||
          secondsPassed > Number(SEND_CHECK_INTERVAL);

        //if a request has not been made yet
        if (allowedSend) {
          //submit job
          console.log("Initialising new CL job request");
          submitNewJob(jobName, sendRequest);
        } else {
          console.log(
            "Will not be initialising new job request - Still waiting for request",
            query.request_id,
            "to finish. Last finished request is",
            query.last_received_request_id
          );
        }
      }
    }
  }, priceQueryInterval * 1_000);
};

/**
 * Function to create a bridge which listens from the Chainlink node for
 * new jobs, job removals and job run results
 * @param {*} PORT the port to listen on
 */
const startBridge = (PORT) => {
  console.log("Bridge started");
  const app = express();
  app.use(bodyParser.json());

  /**
   * POST /adapter endpoint
   * This is used to listen for job run results
   */
  app.post("/adapter", async (req, res) => {
    //get result
    let result = Math.round(req.body.data.result);

    //get run id and type
    let requestId = String(req.body.data.request_id);
    let requestType = Number(req.body.data.request_type);
    let jobName = req.body.data.name;
    console.log(
      "Bridge received " +
        String(result) +
        " for " +
        jobName +
        " (Request: " +
        requestId +
        ", Type: " +
        requestType +
        ")"
    );

    //return a 200 code to the Chainlink node if a successful price is found
    if (!isNaN(result)) {
      res.status(200).send({ success: true });
    } else {
      res.status(500).send({ success: false });
    }

    //get last price from state
    let query = await queryTable("jobs", ["last_result"], jobName);
    let lastPrice = query.last_result;

    //get push interval for feed
    let pushInterval = feeds[jobName].pushInterval;

    //check if time for update
    query = await queryTable("rounds", ["started_at"], jobName);

    let timeForUpdate =
      Date.now() / 1000 >= query.started_at + Number(pushInterval);

    /**
     * if there is no last price, if it is time for a price update 
     * or if there is a new round, update price
     */
    let toUpdate =
      lastPrice == -1 ||
      lastPrice == 0 ||
      (requestType == 1 && timeForUpdate) ||
      requestType == 3;
    //if last price is found and it is a price deviation request
    if (lastPrice != -1 && requestType == 2) {
      //get decimal places for feed
      let decimalPlaces = feeds[jobName].decimalPlaces;
      //calculate percentage change
      lastPrice = lastPrice * Math.pow(10, Number(decimalPlaces));

      let percChange = Math.abs((result - lastPrice) / lastPrice) * 100;
      console.log(
        "Price change is " +
          percChange +
          "%. Last Price: " +
          String(result) +
          ". Current Price: " +
          String(lastPrice)
      );

      //get price deviation threshold for feed
      let priceDeviationPercentage = feeds[jobName].priceDeviationPerc;
      //update price if result is greater than price deviation threshold
      toUpdate = percChange > priceDeviationPercentage;
    }

    //get seconds since last price submission
    query = await queryTable("jobs", ["last_submission_time"], jobName);
    let timePassedSinceSubmission =
      Date.now() / 1000 - query.last_submission_time;
    //check if in submission
    let inSubmission = timePassedSinceSubmission < Number(SEND_CHECK_INTERVAL);

    /**
     * If an update needs to happen
     * An update happens for the following reasons
     *    - First request
     *    - Job request was because time expired
     *    - Price deviation found
     *    - PLUS not already waiting for a submission
     */
    if (toUpdate && !inSubmission) {
      //get latest round
      let latestRound = await queryRound(jobName);
      await updateTable("rounds", latestRound, jobName);

      //get the round for submission
      let query = await queryTable("jobs", ["last_reported_round"], jobName);
      let lastReportedRound = query.last_reported_round;
      let lastRoundId = isNaN(latestRound.round_id)
        ? lastReportedRound
        : latestRound.round_id;
      let roundToSubmit =
        lastReportedRound < lastRoundId ? lastRoundId : lastRoundId + 1;

      //check if new round
      let newRound = roundToSubmit != lastRoundId;

      /**
       * push price on chain if first round, haven't started previous round 
       * and have not submitted yet in the same round
       */
      if (
        roundToSubmit == 1 ||
        (newRound && latestRound.started_by != FROM) ||
        (!newRound && !latestRound.submission_made)
      ) {
        console.log("Updating price for round", roundToSubmit);

        let submitted = await pushPrice(result, jobName, roundToSubmit, FROM);

        //update last reported round
        if (submitted) {
          await updateTable(
            "jobs",
            { last_reported_round: roundToSubmit },
            jobName
          );
        }
      } else {
        console.log("Already started last round or submitted to this round");
      }
    }

    //update state
    await updateTable(
      "jobs",
      { last_received_request_id: Number(requestId) },
      jobName
    );
  });

  /**
   * POST /jobs endpoint
   * This is used to listen for new jobs added from UI and to update state
   */
  app.post("/jobs", async (req, res) => {
    let newJob = req.body.jobId;
    let newJobName = req.body.params.name;
    console.log("new job", newJobName, newJob);

    await createJob(newJob, newJobName);

    res.status(200).send({ success: true });
  });

  /**
   * DELETE /jobs/:id endpoint
   * This is used to listen for jobs deleted from UI and to update state
   */
  app.delete("/jobs/:id", async (req, res) => {
    let jobId = req.params.id;
    console.log("Removing job", jobId);

    await deleteJob(jobId);

    res.status(200).send({ success: true });
  });

  const listener = app.listen(PORT, "0.0.0.0", () => {
    console.log(`External adapter listening on port`, PORT);
  });

  listener.on("error", (err) => {
    console.log("Bridge found error:", err);
  });
};

/** @param {import('../lib/psm.js').BridgeAction} bridgeAction */
const outputAction = (bridgeAction) => {
  const capData = marshaller.serialize(bridgeAction);
  var data = JSON.stringify(capData);
  return data;
};

/**
 * Function to check if currently in submission
 * @param {*} feed feed to check for
 * @returns whether last submission was made in less than SEND_CHECK_INTERVAL 
 *          seconds
 */
const checkIfInSubmission = async (feed) => {
  //get last submission time
  let query = await queryTable("jobs", ["last_submission_time"], feed);
  //get seconds since last price submission
  let timePassedSinceSubmission =
    Date.now() / 1000 - query.last_submission_time;
  return timePassedSinceSubmission < Number(SEND_CHECK_INTERVAL);
};

/**
 * Function to push price on chain to the smart wallet
 * @param {*} price price to push
 * @param {*} feed feed to push price to
 * @param {*} round round to push result to
 * @param {*} from account to push from
 * @returns whether successful
 */
const pushPrice = async (price, feed, round, from) => {
  //create an offerId with the Date number
  var offerId = Date.now();

  //get offers
  let offers = await getOraclesInvitations();
  //get previous offer for feed
  let previousOffer = offers[feed];

  //create an offer
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

  //create keyring
  var keyring = {
    home: "",
    backend: "test",
  };

  //check if submitted for round
  let submitted = await checkSubmissionForRound(from, previousOffer, round);

  //check if in submission
  let inSubmission = await checkIfInSubmission(feed);

  //loop retries
  for (let i = 0; i < SUBMIT_RETRIES && !submitted && !inSubmission; i++) {
    //query round
    let latestRound = await queryRound(feed);

    /**
     * if latestRound is greater than round being pushed or submission to the 
     * round is already made, abort
     */
    if (
      latestRound.round_id > round ||
      (latestRound.round_id == round && latestRound.submission_made)
    ) {
      console.log("Price failed to be submitted for old round", round);
      return false;
    }

    console.log("Submitting price for round", round, "try", i + 1);

    offer.id = Number(Date.now());

    //output action
    var data = outputAction({
      method: "executeOffer",
      // @ts-ignore
      offer,
    });

    //change data to JSON
    data = JSON.parse(data);

    //execute
    await execSwingsetTransaction(
      "wallet-action --allow-spend '" + JSON.stringify(data) + "'",
      networkConfig,
      from,
      false,
      keyring
    );

    //update last submission time
    await updateTable(
      "jobs",
      { last_submission_time: Date.now() / 1000 },
      "feed"
    );

    //sleep 13 seconds to wait 2 blocks and a bit
    await delay((Number(SEND_CHECK_INTERVAL) + 1) * 1000);

    //check submission for round
    submitted = await checkSubmissionForRound(from, previousOffer, round);

    //check if in submission
    inSubmission = await checkIfInSubmission(feed);
  }

  if (submitted) {
    console.log("Price submitted successfully for round", round);
  } else {
    console.log("Price failed to be submitted for round", round);
  }

  return submitted;
};

/**
 * This is the function which runs the middleware
 */
export const middleware = async () => {
  console.log("Starting oracle bridge");

  ({ agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch }));

  //read initiator credentials
  credentials = readJSONFile(CREDENTIALS_FILE);

  //read feeds config
  feeds = readJSONFile(FEEDS_FILE);

  //init
  await initialiseState();

  //start the bridge
  startBridge(PORT);

  //calculate how many seconds left for a new minute
  let secondsLeft = 60 - new Date().getSeconds();

  //start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000);
};
