import { readJSONFile } from "./utils.js";
import axios from "axios";
import http from "http";

const {
  EI_CHAINLINKURL,
  SUBMIT_RETRIES = 3,
  CREDENTIALS_FILE = "config/ei_credentials.json",
} = process.env;

if (process.env.NODE_ENV != "test") {
  assert(EI_CHAINLINKURL, "$EI_CHAINLINKURL is required");
  assert(CREDENTIALS_FILE != "", '$CREDENTIALS_FILE is required');
}

/**
 * Function to send a job run to the CL node
 * @param {number} count the request id
 * @param {string} jobId the Chainlink external job id
 * @param {number} requestType the request type, 1 = time, 2 = deviation, 3 = *                             new round
 */
export const sendJobRun = async (count, jobId, requestType) => {
  //read initiator credentials
  const credentials = readJSONFile(CREDENTIALS_FILE);

  const options = {
    url: EI_CHAINLINKURL + "/v2/jobs/" + jobId + "/runs",
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
        timeout: 5000,
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
