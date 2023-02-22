// @ts-nocheck
/* eslint-disable func-names */

import { 
  validUrl, 
  readJSONFile, 
  initialiseState, 
  submitNewJob 
} from '../helpers/utils.js';
import { 
  getAllJobs, 
  queryTable, 
  updateTable
} from '../helpers/db.js'
import { startBridge } from '../helpers/bridge.js'
import { 
  queryPrice, 
  queryRound, 
  getLatestSubmittedRound 
} from '../helpers/chain.js'

// get environment variables
const {
  PORT = '3000',
  FROM,
  BLOCK_INTERVAL = '6',
  SEND_CHECK_INTERVAL = '45',
  AGORIC_RPC = "http://0.0.0.0:26657",
  FEEDS_FILE = "../config/feeds-config.json"
} = process.env;

/** 
  * Environment variables validation
  */
if (process.env.NODE_ENV !== "test"){
  assert(FROM, '$FROM is required');
  assert(Number(PORT), "$PORT is required");
  assert(Number(BLOCK_INTERVAL), "$BLOCK_INTERVAL is required");
  assert(Number(SEND_CHECK_INTERVAL), "$SEND_CHECK_INTERVAL is required");
  assert(validUrl(AGORIC_RPC), '$AGORIC_RPC is required');
  assert(FEEDS_FILE !== "", '$FEEDS_FILE is required');
}

let feeds;

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
    jobs.forEach( async (job) => {

      //get interval for feed
      let feedName = job.name;
      let pollInterval = feeds[feedName].pollInterval

      //check whether poll interval expired
      let now = Date.now() / 1000
      let query = await queryTable("jobs", ["last_request_sent"], feedName)
      let timeForPoll = query.last_request_sent + pollInterval <= now

      //if interval expired
      if (timeForPoll){
        /**
         * send a job run with type 1, indicating a job run triggered from the 
         * polling interval
         */
        await submitNewJob(feedName, 1)
      }
    });
  }, oneSecInterval);


  const priceQueryInterval = parseInt(BLOCK_INTERVAL, 10);
  //validate polling interval
  assert(!isNaN(priceQueryInterval), `$BLOCK_INTERVAL ${BLOCK_INTERVAL} must be a number`);

  /**
    * create an interval which query the price and creates a Chainlink job
    * request if the price deviates more than a specific threshold
    */
  const it2 = setInterval(async () => {

    //get all jobs
    let jobs = await getAllJobs();

    //for each job
    jobs.forEach( async (job) => {
      //get the job name
      let jobName = job.name;

      let sendRequest = 0;

      //query the price
      let latestPrice = await queryPrice(jobName)

      //get latest price
      let query = await queryTable("jobs", ["last_result"], jobName)
      let currentPrice = query.last_result

      //query latest round
      let latestRound = await queryRound(jobName);

      //get latest submitted round
      let latestSubmittedRound = await getLatestSubmittedRound(FROM)
    
      //update jobs table
      await updateTable("jobs", {"last_result" : latestPrice, "last_reported_round": latestSubmittedRound}, jobName)

      //update rounds table
      await updateTable("rounds", latestRound, jobName)

      //if latest round is bigger than last reported round
      if (latestRound.round_id > latestSubmittedRound) {
        //if submitted, update last_reported_round
        if (latestRound.submission_made) {
          await updateTable("jobs", {"last_reported_round": latestSubmittedRound}, jobName)
        }
        //if not found send job request
        else {
          console.log("Found new round.")
          sendRequest = 3
        }
      }

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
      if (sendRequest !== 0) {

        //get seconds now
        let secondsNow = Date.now() / 1000
        //check seconds passed from last request
        let query = await queryTable("jobs", ["last_request_sent"], jobName)
        let secondsPassed = secondsNow - query.last_request_sent

        /**
         * check if allowed to send - 45 seconds passed or a request has not 
         * been made.
         */
        query = await queryTable("jobs", ["last_received_request_id", "request_id"], jobName)
        let allowedSend = query.request_id === query.last_received_request_id || secondsPassed > Number(SEND_CHECK_INTERVAL)

        //if a request has not been made yet
        if (allowedSend) {
          //submit job
          console.log("Initialising new CL job request")
          submitNewJob(jobName, sendRequest)
        }
        else{
          console.log("Will not be initialising new job request - Still waiting for request", query.request_id, "to finish. Last finished request is", query.last_received_request_id)
        }
      }
    })
  }, priceQueryInterval * 1_000);
}


/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  console.log('Starting oracle bridge');

  //read feeds config
  feeds = readJSONFile(FEEDS_FILE)

  //init
  await initialiseState()

  //start the bridge
  startBridge(PORT);

  //calculate how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  //start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};