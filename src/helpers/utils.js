import fs from "fs";
import { URL } from "url";
import { 
  createDBs, 
  queryTable, 
  updateTable 
} from "./db.js";
import { sendJobRun } from "./chainlink.js";

// get environment variables
const { SEND_CHECK_INTERVAL = "45" } = process.env;

/**
 * Environment variables validation
 */
if (process.env.NODE_ENV != "test") {
  assert(Number(SEND_CHECK_INTERVAL), "$SEND_CHECK_INTERVAL is required");
}

/**
 * Function to read a json file
 * @param {string} filename  file name or path to read
 * @returns {Object} the JSON data in the file
 */
export const readJSONFile = (filename) => {
  let rawdata = fs.readFileSync(filename);
  let data = JSON.parse(String(rawdata));
  return data;
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
 * Function to check whether a URL is valid or not
 * @param {string} url the URL to check
 * @returns {boolean} whether the url is valid or not
 */
export const validUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
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
  //create tables if they do not exist
  await createDBs();
};

/**
 * Function to submit a new job run to the Chainlink node
 * @param {string} feed the feed to submit a job for
 * @param {number} requestType the request type to send as a parameter with the job request. 1 if a timer request, 2 if triggered by a price deviation, 3 new round.
 */
export const submitNewJob = async (feed, requestType) => {
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
  await sendJobRun(newRequestId, query.id, requestType);
};

/**
 * Function to check if currently in submission
 * @param {string} feed feed to check for
 * @returns {boolean} whether last submission was made in less than SEND_CHECK_INTERVAL seconds
 */
export const checkIfInSubmission = async (feed) => {
  //get last submission time
  let query = await queryTable("jobs", ["last_submission_time"], feed);
  //get seconds since last price submission
  let timePassedSinceSubmission =
    Date.now() / 1000 - query.last_submission_time;
  return timePassedSinceSubmission < Number(SEND_CHECK_INTERVAL);
};
