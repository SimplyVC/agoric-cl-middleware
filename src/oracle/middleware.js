/* eslint-disable no-await-in-loop */
/* eslint-disable @jessie.js/no-nested-await */
// @ts-check
/* eslint-disable func-names */
/* global fetch, process */

/** 
 * IMPORTS
 */
import { execSwingsetTransaction } from '../lib/chain.js';
import {
  makeRpcUtils,
  boardSlottingMarshaller,
  networkConfig
} from '../lib/rpc.js'
import axios from 'axios';
import http from 'http';
import fs from 'fs';
import { getCurrent } from '../lib/wallet.js';
import bodyParser from 'body-parser';
import { Far } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import express from 'express';
import { validUrl, delay, saveJSONDataToFile, readJSONFile } from './helper.js';
import {
  makeFollower,
  makeLeader,
} from '@agoric/casting';
import { iterateReverse } from '@agoric/casting';

// get environment variables
const {
  PORT = '3000',
  EI_CHAINLINKURL,
  FROM,
  SUBMIT_RETRIES = 3,
  BLOCK_INTERVAL = '6',
  SEND_CHECK_INTERVAL = '12',
  AGORIC_RPC = "http://0.0.0.0:26657",
  STATE_FILE = "data/middleware_state.json",
  CREDENTIALS_FILE = "config/ei_credentials.json",
  OFFERS_FILE = "config/offers.json",
  FEEDS_FILE = "oracle/feeds.json"
} = process.env;

/** 
  * Environment variables validation
  */
assert(EI_CHAINLINKURL, '$EI_CHAINLINKURL is required');
assert(Number(SUBMIT_RETRIES), '$SUBMIT_RETRIES is required');
assert(FROM, '$FROM is required');
assert(validUrl(AGORIC_RPC), '$AGORIC_RPC is required');
assert(STATE_FILE != "", '$STATE_FILE is required');
assert(CREDENTIALS_FILE != "", '$CREDENTIALS_FILE is required');
assert(OFFERS_FILE != "", '$OFFERS_FILE is required');
assert(FEEDS_FILE != "", '$FEEDS_FILE is required');

const { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });
const marshaller = boardSlottingMarshaller();

//read initiator credentials
const credentials = readJSONFile(CREDENTIALS_FILE)

//read feeds config
const feeds = readJSONFile(FEEDS_FILE)

/**
  * Function to load from file or initialise it
  * @returns empty state or state from file
  */
const readState = () => {
  // try to read JSON file and if it doesnt exist, create one
  try {
    //read JSON file
    return readJSONFile(STATE_FILE)
  } catch (err) {

    //create an initial state
    let initial_state = {
      "jobs": [],
      "previous_results": {}
    }

    //save state
    saveJSONDataToFile(initial_state, STATE_FILE)
    return initial_state
  }
}

/**
  * Function to initialise state
  */
const initialiseState = () => {
  //read state
  let state = readState()

  //go through each job
  for (let index in state.jobs) {
    let currentJob = state.jobs[index]
    //if not initialised
    if (!(currentJob.name in state.previous_results)) {
      state.previous_results[currentJob.name] = {
        id: currentJob.job,
        result: 0,
        round: {}
      }
    }
  }

  //save state
  saveJSONDataToFile(state, STATE_FILE);
}

/**
  * Function to get the job's index
  * @param {*} jobName the job name 
  * @returns the index of the job
  */
const getJobIndex = (jobName) => {
  //read state
  let state = readState()

  //go through each job
  for (let index in state.jobs) {
    let currentJob = state.jobs[index]
    //if not initialised
    if (currentJob.name == jobName) {
      return index
    }
  }
  return -1
}


/**
  * Function to send a job run to the CL node
  * @param {*} credentials the external initiator credentials
  * @param {*} count the request id
  * @param {*} jobId the Chainlink external job id
  * @param {*} chainlinkUrl the Chainlink node url where to send the job request
  * @param {*} requestType the request type, 1 = time, 2 = deviation, 3 = new round
  */
const sendJobRun = async (credentials, count, jobId, chainlinkUrl, requestType) => {
  const options = {
    url: chainlinkUrl + "/v2/jobs/" + jobId + "/runs",
    body: {
      "payment": 0,
      "request_id": count,
      "request_type": requestType
    },
    headers: {
      "Content-Type": "application/json",
      "X-Chainlink-EA-AccessKey": credentials["EI_IC_ACCESSKEY"],
      "X-Chainlink-EA-Secret": credentials["EI_IC_SECRET"]
    },
    method: 'POST',
  };

  //try request with loop retries
  let error = ""
  for (let i = 0; i < SUBMIT_RETRIES; i++) {
    try {
      let res = await axios.post(options.url, options.body, {
        timeout: 60000,
        proxy: false,
        headers: options.headers,
        httpAgent: new http.Agent({ keepAlive: true })
      });
      return
    }
    catch (err) {
      console.error("JOB Request for " + jobId + " failed", err)
      error = err
    }
  }
}

/**
  * Function to get last 10 offers
  * @param {*} follower offers and balances
  * @returns a list of offers
  */
const getOffers = async (follower) => {

  let history = [];
  let counter = 0;
  for await (const followerElement of iterateReverse(follower)) {

    if (counter == 10){
      break;
    }
    //if it is an offer status and not failed
    if (followerElement.value.updated == "offerStatus" && !followerElement.value.status.hasOwnProperty("error")) {
      history.push(followerElement.value);
    }
    counter++
  }
  return history
}


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

  const follower = await makeFollower(
    `:published.wallet.${oracle}`,
    leader,
    {
      // @ts-expect-error xxx
      unserializer,
    },
  );

  //get offers
  let offers = await getOffers(follower)

  //loop through offers starting from last offer
  for (var i = 0; i < offers.length; i++) {
    //get current offer
    var currentOffer = offers[i];

    //if a price invitation and for the correct feed
    if (currentOffer["status"]["invitationSpec"]["invitationMakerName"] == "PushPrice" && currentOffer["status"]["invitationSpec"]["previousOffer"] == feedOfferId) {
      let offerRound = Number(currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"])

      //if it is an offer for the round we are checking for
      if (offerRound == roundId) {
        //if there is no error
        if (!currentOffer["status"].hasOwnProperty("error")) {
          return true
        }
      }
      //else if offer round id is less than the round we want to check and its satisfied
      //return false because there cannot be a submission for a newer round before this offer 
      else if (offerRound < roundId && !currentOffer["status"].hasOwnProperty("error")) {
        return false
      }
    }
  }
  return false
}

/**
  * Function to query price from chain
  * @param {*} feed feed name of the price to query in the form of ATOM-USD
  * @returns the latest price
  */
const queryPrice = async (feed) => {

  try {
    //read value from vstorage
    const capDataStr = await vstorage.readLatest(`published.priceFeed.${feed}_price_feed`);

    //parse the value
    var capData = JSON.parse(JSON.parse(capDataStr).value)
    capData = JSON.parse(capData.values[0])
    //replace any extra characters
    capData = JSON.parse(capData.body.replaceAll("\\", ""))

    //get the latest price by dividing amountOut by amountIn
    var latestPrice = Number(capData.amountOut.value.digits) / Number(capData.amountIn.value.digits)

    console.log(feed + " Price Query: " + String(latestPrice))
    return latestPrice
  }
  catch {
    return 0
  }
}

/**
 * Function to get oracles feed invitations
 */
export const getOraclesInvitations = async () => {

  let feedBoards = agoricNames.reverse

  let feedInvs = {}

  const current = await getCurrent(String(FROM), fromBoard, { vstorage });
  const invitations = current.offerToUsedInvitation

  //for each invitation
  for (let inv in invitations) {
    let boardId = invitations[inv].value[0].instance.boardId
    let feed = feedBoards[boardId].split(" price feed")[0]

    feedInvs[feed] = Number(inv)
  }

  return feedInvs
}

/**
  * Function to query round from chain
  * @param {*} feed feed name of the price to query in the form of ATOM-USD
  * @returns the latest round
  */
const queryRound = async (feed) => {

  //read value from vstorage
  const capDataStr = await vstorage.readLatest(
    `published.priceFeed.${feed}_price_feed.latestRound`,
  );

  //parse the value
  var capData = JSON.parse(JSON.parse(capDataStr).value)
  capData = JSON.parse(capData.values[capData.values.length - 1])
  //replace any extra characters
  capData = JSON.parse(capData.body.replaceAll("\\", ""))

  //get round from result
  let round = Number(capData.roundId.digits)

  //get offers
  let offers = await getOraclesInvitations()
  //get feed offer id
  let feedOfferId = offers[feed]

  //check if there is a submission for round
  let submissionForRound = await checkSubmissionForRound(FROM, feedOfferId, round)

  //get the latest round
  var latestRound = {
    roundId: round,
    startedAt: Number(capData.startedAt.digits),
    startedBy: capData.startedBy,
    submissionMade: submissionForRound
  }

  console.log(feed + " Latest Round: ", latestRound.roundId)
  return latestRound
}

/**
  * Function to submit a new job run to the Chainlink node
  * @param {*} index the index of the job in the state data
  * @param {*} requestType the request type to send as a parameter with the job request. 1 if a timer request, 2 if triggered by a price deviation, 3 new round.
  */
const submitNewJobIndex = async (index, requestType) => {

  let state = readState()
  //increment the request id of the job in the state
  state.jobs[index].request_id++;
  //set the time sent
  state.jobs[index].last_request_sent = Date.now() / 1000;

  let requestId = state.jobs[index].request_id;
  let job = state.jobs[index].job

  console.log("Sending job spec", job, "request", requestId)

  //update state
  saveJSONDataToFile(state, STATE_FILE)

  //send job run
  await sendJobRun(credentials, requestId, job, EI_CHAINLINKURL, requestType)
}

/**
  * Controller for the middleware
  */
const makeController = () => {
  const oneSecInterval = 1 * 1_000;

  //create an interval which creates a job request every second
  const it = setInterval(async () => {

    //read the state
    let state = readState();

    //for each job in state, send a job run
    for (let index in state.jobs) {

      //get interval for feed
      let feedName = state.jobs[index].name;
      let pollInterval = feeds[feedName].pollInterval

      //check whether poll interval expired
      let now = Date.now() / 1000
      let timeForPoll = state.jobs[index].last_request_sent + pollInterval <= now

      //if interval expired
      if (timeForPoll){
        //send a job run with type 1, indicating a job run triggered from the polling interval
        await submitNewJobIndex(index, 1)
      }
    }
  }, oneSecInterval);


  const priceQueryInterval = parseInt(BLOCK_INTERVAL, 10);
  //validate polling interval
  assert(!isNaN(priceQueryInterval), `$BLOCK_INTERVAL ${BLOCK_INTERVAL} must be a number`);

  /**
    * create an interval which query the price and creates a chainlink job request 
    * if the price deviates more than a specific threshold
    */
  const it2 = setInterval(async () => {

    //read state
    let state = readState();

    //for each job in state
    for (var i = 0; i < state.jobs.length; i++) {
      //get the job name
      let jobName = state.jobs[i].name;

      let sendRequest = 0;

      //query the price
      let latestPrice = await queryPrice(jobName)
      let currentPrice = jobName in state.previous_results ? state.previous_results[jobName].result : 0

      //query latest round
      let latestRound = await queryRound(jobName);

      //reread state in case of updates
      state = readState();

      //update latest price
      state.previous_results[jobName].result = latestPrice
      //update latest round
      state.previous_results[jobName].round = latestRound

      //if latest round is bigger than last reported round
      if (latestRound.roundId > state.jobs[getJobIndex(jobName)].last_reported_round) {
        //if submitted, update last_reported_round
        if (latestRound.submissionMade) {
          state.jobs[getJobIndex(jobName)].last_reported_round = latestRound.roundId
        }
        //if not found send job request
        else {
          console.log("Found new round.")
          sendRequest = 3
        }
      }

      saveJSONDataToFile(state, STATE_FILE)

      //if there's a price deviation
      let priceDev = Math.abs((latestPrice - currentPrice) / currentPrice) * 100

      if (priceDev > 0){
        console.log("Found a price deviation for", jobName, "of", priceDev, "%. Latest price:", latestPrice, " Current Price:", currentPrice)
      }

      //get feed deviation percentage threshold
      let priceDeviationPercentage = feeds[jobName].priceDeviationPerc
      if (priceDev > priceDeviationPercentage) {
        sendRequest = 2
      }

      //if there is a request to be sent
      if (sendRequest != 0) {

        //get seconds now
        let secondsNow = Date.now() / 1000
        //check seconds passed from last request
        let secondsPassed = secondsNow - state.jobs[i].last_request_sent

        //check if allowed to send - 12 seconds passed or a request hasnt been made.
        //12 seconds chosen to wait at least 2 blocks
        let allowedSend = state.jobs[i].request_id == state.previous_results[jobName].request_id || secondsPassed > Number(SEND_CHECK_INTERVAL)

        //if a request hadnt been made yet
        if (allowedSend) {
          //submit job
          console.log("Initialising new CL job request")
          submitNewJobIndex(i, sendRequest)
        }
        else{
          console.log("Will not be initialising new job request - Still waiting for request", state.jobs[i].request_id, "to finish. Last finished request is", state.previous_results[jobName].request_id)
        }
      }
    }
  }, priceQueryInterval * 1_000);

}

/**
  * Function to create a bridge which listens from the Chainlink node for
  * new jobs, job removals and job run results
  * @param {*} PORT the port to listen on
  */
const startBridge = (PORT) => {

  console.log("Bridge started")
  const app = express();
  app.use(bodyParser.json());

  /**
  * POST /adapter endpoint
  * This is used to listen for job run results
  */
  app.post('/adapter', async (req, res) => {
    //read state
    let state = readState()

    //get result
    let result = Math.round(req.body.data.result)

    //get run id and type
    let requestId = String(req.body.data.request_id)
    let requestType = Number(req.body.data.request_type)
    let jobName = req.body.data.name
    console.log("Bridge received " + String(result) + " for " + jobName + " (Request: " + requestId + ", Type: " + requestType + ")")

    //return a 200 code to the Chainlink node if a successful price is found
    if (!isNaN(result)){
      res.status(200).send({ success: true })
    } else {
      res.status(500).send({ success: false })
    } 

    //get last price from state
    let lastPrice = (state.previous_results[jobName]) ? state.previous_results[jobName].result : -1

    //get push interval for feed
    let pushInterval = feeds[jobName].pushInterval

    //check if time for update
    let timeForUpdate = (Date.now()/1000) >= state.previous_results[jobName].round.startedAt + Number(pushInterval)
    console.log(Date.now()/1000, state.previous_results[jobName].round.startedAt + Number(pushInterval))

    //if there is no last price, if it is time for a price update or if there is a new round, update price
    let toUpdate = lastPrice == -1 || requestType == 1 && timeForUpdate || requestType == 3
    //if last price is found and it is a price deviation request
    if (lastPrice != -1 && requestType == 2) {
      
      //get decimal places for feed
      let decimalPlaces = feeds[jobName].decimalPlaces
      //calculate percentage change
      lastPrice = lastPrice * Math.pow(10, Number(decimalPlaces))

      let percChange = Math.abs((result - lastPrice) / lastPrice) * 100
      console.log("Price change is " + percChange + "%. Last Price: " + String(result) + ". Current Price: " + String(lastPrice))

      //get price deviation threshold for feed
      let priceDeviationPercentage = feeds[jobName].priceDeviationPerc
      //update price if result is greater than price deviation threshold
      toUpdate = percChange > priceDeviationPercentage
    }

    /**
      * If an update needs to happen
      * An update happens for the following reasons
      *    - First request
      *    - Job request was because time expired
      *    - Price deviation found
      */
    if (toUpdate) {

      //get latest queried round
      let latestRound = state.previous_results[jobName].round

      //get the round for submission
      let lastReportedRound = state.jobs[getJobIndex(jobName)].last_reported_round
      let lastRoundId = isNaN(latestRound.roundId) ? lastReportedRound : latestRound.roundId
      let roundToSubmit = lastReportedRound < lastRoundId ? lastRoundId : lastRoundId + 1

      //check if new round
      let newRound = roundToSubmit != lastRoundId

      //push price on chain if first round, haven't started previous round and havent submitted yet in the same round
      if (roundToSubmit == 1 || (newRound && latestRound.startedBy != FROM) || (!newRound && !latestRound.submissionMade)) {
        console.log("Updating price for round", roundToSubmit)
        let submitted = await pushPrice(result, jobName, roundToSubmit, FROM)

        //update last reported round
        if (submitted){
          state.jobs[getJobIndex(jobName)].last_reported_round = roundToSubmit
        }
      }
      else {
        console.log("Already started last round or submitted to this round")
      }
    }

    //update state
    state.previous_results[jobName].request_id = Number(requestId)
    saveJSONDataToFile(state, STATE_FILE)

  });

  /**
   * POST /jobs endpoint
   * This is used to listen for new jobs added from UI and to update state
   */
  app.post('/jobs', (req, res) => {
    let newJob = req.body.jobId;
    let newJobName = req.body.params.name;

    //read state
    let state = readState()

    //add new job to state
    state.jobs.push({
      job: newJob,
      name: newJobName,
      request_id: 0,
      last_reported_round: 0
    });

    //add previous results
    state.previous_results[newJobName] = {
      id: newJob,
      result: 0,
      request_id: 0,
      round: {}
    }

    //save state
    saveJSONDataToFile(state, STATE_FILE)
    console.log("Got new job", newJob)
    console.log("new jobs", state.jobs)
    res.status(200).send({ success: true })
  });

  /**
   * DELETE /jobs/:id endpoint
   * This is used to listen for jobs deleted from UI and to update state
   */
  app.delete('/jobs/:id', (req, res) => {
    let jobId = req.params.id;
    console.log("Removing job", jobId)

    //read syaye
    let state = readState()

    let jobName = ""

    //loop through jobs
    for (var index in state.jobs) {
      //if job is found, remove it
      if (state.jobs[index].job == jobId) {
        jobName = state.jobs[index].name
        state.jobs.splice(index, 1);
        break;
      }
    }

    delete state.previous_results[jobName]

    //save state
    saveJSONDataToFile(state, STATE_FILE)
    res.status(200).send({ success: true })
  });

  const listener = app.listen(PORT, '0.0.0.0', () => {
    console.log(`External adapter listening on port`, PORT);
  });

  listener.on('error', err => { console.log("Bridge found error:", err) })
}

/** @param {import('../lib/psm.js').BridgeAction} bridgeAction */
const outputAction = bridgeAction => {
  const capData = marshaller.serialize(bridgeAction);
  var data = JSON.stringify(capData)
  return data
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
  var offerId = Date.now()

  //get offers
  let offers = await getOraclesInvitations()
  //get previous offer for feed
  let previousOffer = offers[feed]

  //create an offer
  const offer = {
    id: Number(offerId),
    invitationSpec: {
      source: 'continuing',
      previousOffer: Number(previousOffer),
      invitationMakerName: 'PushPrice',
      invitationArgs: harden([{ unitPrice: BigInt(price), roundId: round }]),
    },
    proposal: {},
  };

  console.log("Submitting offer", offer)

  //output action
  var data = outputAction({
    method: 'executeOffer',
    // @ts-ignore
    offer,
  });

  //change data to JSON
  data = JSON.parse(data)

  //create keyring
  var keyring = {
    "home": "",
    "backend": "test"
  }

  //check if submitted for round
  let submitted = await checkSubmissionForRound(from, previousOffer, round)

  //loop retries
  for (let i = 0; i < SUBMIT_RETRIES && !submitted; i++) {

    //query round
    let latestRound = await queryRound(feed)
    
    //if latestRound is greater than round being pushed or submission to the round is already made, abort
    if (latestRound.roundId > round || (latestRound.roundId == round && latestRound.submissionMade)){
      console.log("Price failed to be submitted for old round", round)
      return false
    }

    console.log("Submitting price for round", round, "try", (i + 1))
    //execute
    await execSwingsetTransaction(
      "wallet-action --allow-spend '" + JSON.stringify(data) + "'",
      networkConfig,
      from,
      false,
      keyring,
    );

    //sleep 13 seconds to wait 2 blocks and a bit
    await delay((Number(SEND_CHECK_INTERVAL)+1) * 1000);

    //check submission for round
    submitted = await checkSubmissionForRound(from, previousOffer, round)
  }

  if (submitted) {
    console.log("Price submitted successfully for round", round)
  }
  else {
    console.log("Price failed to be submitted for round", round)
  }

  return submitted
}

/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  console.log('Starting oracle bridge');

  //init
  initialiseState()

  //start the bridge
  startBridge(PORT);

  //calcualte how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  //start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};