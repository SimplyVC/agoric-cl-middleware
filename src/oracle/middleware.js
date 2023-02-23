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
  const oneSecInterval = 1_000;

  // Create an interval which creates a job request every second
  setInterval(async () => {

    // Get all jobs
    let jobs = await getAllJobs();

    // For each job in state, send a job run
    jobs.forEach( async (job) => {

      // Get interval for feed
      let feedName = job.name;
      let pollInterval = Number(feeds[feedName].pollInterval)

      // Check whether poll interval expired
      let now = Date.now() / 1000
      let query = await queryTable("jobs", ["last_request_sent"], feedName)
      let timeForPoll = query.last_request_sent + pollInterval <= now

      // If interval expired
      if (timeForPoll){
        /**
         * Send a job run with type 1, indicating a job run triggered from the 
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
  setInterval(async () => {

    // Get all jobs
    let jobs = await getAllJobs();

    // For each job
    jobs.forEach( async (job) => {
      // Get the job name
      let jobName = job.name;

      let sendRequest = 0;

      // Query the price
      let latestPrice = await queryPrice(jobName)

      // Get latest price
      let query = await queryTable("jobs", ["last_result"], jobName)
      let currentPrice = query.last_result

      // Query latest round
      let latestRound = await queryRound(jobName);

      // Get latest submitted round
      let latestSubmittedRound = await getLatestSubmittedRound(FROM)
    
      // Update jobs table
      await updateTable("jobs", {"last_result" : latestPrice, "last_reported_round": latestSubmittedRound}, jobName)

      // Update rounds table
      await updateTable("rounds", latestRound, jobName)

      // If latest round is bigger than last reported round
      if (latestRound.round_id > latestSubmittedRound) {
        // If submitted, update last_reported_round
        if (latestRound.submission_made) {
          await updateTable("jobs", {"last_reported_round": latestSubmittedRound}, jobName)
        } else {
          // If not found, send job request
          console.log("Found new round.")
          sendRequest = 3
        }
      }

      // If there's a price deviation
      let priceDev = Math.abs((latestPrice - currentPrice) / currentPrice) * 100

      if (priceDev > 0){
        console.log("Found a price deviation for", jobName, "of", priceDev, "%. Latest price:", latestPrice, " Current Price:", currentPrice)
      }

      // Get feed deviation percentage threshold
      let priceDeviationPercentage = Number(feeds[jobName].priceDeviationPerc)
      if (priceDev > priceDeviationPercentage) {
        sendRequest = 2
      }

      // If there is a request to be sent
      if (sendRequest !== 0) {

        // Get seconds now
        let secondsNow = Date.now() / 1000
        // Check seconds passed from last request
        let query = await queryTable("jobs", ["last_request_sent"], jobName)
        let secondsPassed = secondsNow - query.last_request_sent

        /**
         * Check if allowed to send - 45 seconds passed or a request has not 
         * been made.
         */
        query = await queryTable("jobs", ["last_received_request_id", "request_id"], jobName)

        /**
         * Checks if there are any pending CL job requests for which we are
         * still waiting. If so, a new CL job request should not be sent
         */
        let noPendingRequests = query.request_id === query.last_received_request_id;
        let enoughTimePassed = secondsPassed > Number(SEND_CHECK_INTERVAL)

        // If a request has not been made yet and we are not waiting
        if (noPendingRequests || enoughTimePassed) {
          // Submit job
          console.log("Initialising new CL job request")
          submitNewJob(jobName, sendRequest)
        } else {
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

  // Read feeds config
  feeds = readJSONFile(FEEDS_FILE)

  // Init
  await initialiseState()

  // Start the bridge
  startBridge(PORT);

  // Calculate how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  // Start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};