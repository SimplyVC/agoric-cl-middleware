import fs from "fs";
import { 
  createDBs, 
  queryTable, 
  updateTable 
} from "./db.js";
import { sendJobRun } from "./chainlink.js";
import { MiddlewareENV } from './MiddlewareEnv.js';
import { logger } from "./logger.js";

// Load environment variables
let envvars = {};
try{
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test" && process.env.SERVICE !== "monitor") {
    logger.error("ERROR LOADING ENV VARS: " + err)
    process.exit(1);
  }
}

export const FEEDS_FILE = "../config/feeds-config.json"

/**
 * Function to read a json file
 * @param {string} filename  file name or path to read
 * @returns {Object} the JSON data in the file
 */
export const readJSONFile = (filename) => {
  try{
    let rawdata = fs.readFileSync(filename);
    return JSON.parse(String(rawdata));
  } catch (err) {
    logger.error("Failed to read JSON file " + filename + ": " + err);
  }
};

/**
 * Function to save JSON data to a file
 * @param {Object} newData new JSON data to save
 * @param {string} filename filename to save data to
 */
export const saveJSONDataToFile = (newData, filename) => {
  let data = JSON.stringify(newData);
  fs.writeFileSync(filename, data);
};

/**
 * Function to create a delay
 * @param {number} ms milliseconds to delay
 * @returns {Promise} a Promise to delay
 */
export const delay = async (ms) => {
  return new Promise(async (res) => await setTimeout(res, ms));
};

/**
 * Function to initialise state
 */
export const initialiseState = async () => {
  // Create tables if they do not exist
  await createDBs();
};

/**
 * Function to submit a new job run to the Chainlink node
 * @param {string} feed the feed to submit a job for (Ex. ATOM-USD)
 * @param {number} requestType the request type to send as a parameter with the 
 *                             job request. 1 if a timer request, 2 if 
 *                             triggered by a price deviation, 3 new round.
 */
export const submitNewJob = async (feed, requestType) => {
  // Get latest request id
  let query = await queryTable("jobs", ["request_id", "id"], feed);
  let newRequestId = query.request_id + 1;

  // Update table
  await updateTable(
    "jobs",
    { request_id: newRequestId, last_request_sent: Date.now() / 1000 },
    feed
  );

  logger.info("Sending job spec " + feed + " request " + newRequestId);

  // Send job run
  await sendJobRun(newRequestId, query.id, requestType);
};

/**
 * Function to check if currently in submission
 * @param {string} feed feed to check for (Ex. ATOM-USD)
 * @returns {boolean} whether last submission was made in less than 
 *                    envvars.SEND_CHECK_INTERVAL seconds
 */
export const checkIfInSubmission = async (feed) => {
  // Get last submission time
  let query = await queryTable("jobs", ["last_submission_time"], feed);

  // Get seconds since last price submission
  let timePassedSinceSubmission =
    Date.now() / 1000 - query.last_submission_time;

  return timePassedSinceSubmission < Number(envvars.SEND_CHECK_INTERVAL);
};

/**
 * Function to check if an update should happen
 * 
 * There needs to be a price update if:
 *  - There is no last price
 *  - It is time for a price update
 *  - There is a new round
 *  - The middleware is not waiting for a submission to be confirmed
 * 
 * @param {string} jobName the job name to check for (Ex. ATOM-USD)
 * @param {number} requestType the type of request for which we received a price
 * @param {number} result the price received from the CL node
 * @returns {boolean} whether a price should be updated on chain
 */
export const checkForPriceUpdate = async (jobName, requestType, result) => {

  //get feeds
  let feeds = readJSONFile(FEEDS_FILE);

  if (!(jobName in feeds)) {
    throw new Error(
      jobName + " not found in list of feeds"
    );
  }

  // Get time now 
  let now = Date.now() / 1000;

  // Get seconds since last price submission
  let query = await queryTable("jobs", ["last_submission_time", "last_result"], jobName);
  
  let timePassedSinceSubmission = now - query.last_submission_time;

  // Check if in submission
  let inSubmission = timePassedSinceSubmission < Number(envvars.SEND_CHECK_INTERVAL);

  // If in submission return false
  if (inSubmission) {
    return false
  }

  // Get last price from state
  let lastPrice = query.last_result;

  // Get push interval for feed
  let pushInterval = Number(feeds[jobName].pushInterval);

  // Check if time for update
  query = await queryTable("rounds", ["started_at"], jobName);

  // Check if it is time for an update
  let timeForUpdate = now >= query.started_at + pushInterval;

  // Check if there was a last price
  let noLastPrice = lastPrice === -1 || lastPrice === 0;

  // Check if update time expired
  let updateTimeExpired = requestType === 1 && timeForUpdate;

  // Check if a new round was found
  let newRoundFound = requestType === 3;

  // Check if an update is needed
  let toUpdate = noLastPrice || updateTimeExpired || newRoundFound

  //Check if it is a price deviation request
  let priceDeviationRequest = requestType === 2

  // If last price is found and it is a price deviation request
  if (!noLastPrice && priceDeviationRequest) {

    // Get decimal places for feed
    let decimalPlaces = Number(feeds[jobName].decimalPlaces);
    // Calculate percentage change
    lastPrice = lastPrice * Math.pow(10, decimalPlaces);

    let percChange = Math.abs((result - lastPrice) / lastPrice) * 100;
    logger.info(
      "Price change is " +
        percChange +
        "%. Last Price: " +
        String(result) +
        ". Current Price: " +
        String(lastPrice)
    );

    // Get price deviation threshold for feed
    let priceDeviationPercentage = Number(feeds[jobName].priceDeviationPerc);

    // Update price if result is greater than price deviation threshold
    toUpdate = percChange >= priceDeviationPercentage;
  }

  return toUpdate
}