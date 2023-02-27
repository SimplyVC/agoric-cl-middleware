import axios from "axios";
import http from "http";
import middlewareEnvInstance from './middleware-env.js';
import { logger } from "./logger.js";
import { Credentials } from "./credentials.js";

/**
 * Function to send a job run to the CL node
 * @param {number} count the request id
 * @param {string} jobId the Chainlink external job id
 * @param {number} requestType the request type, 1 = time, 2 = deviation, 3 = 
 *                             new round
 */
export const sendJobRun = async (count, jobId, requestType) => {
  // Read initiator credentials
  const credentials = new Credentials(middlewareEnvInstance.CREDENTIALS_FILE);

  const options = {
    url: middlewareEnvInstance.EI_CHAINLINKURL + "/v2/jobs/" + jobId + "/runs",
    body: {
      payment: 0,
      request_id: count,
      request_type: requestType,
    },
    headers: {
      "Content-Type": "application/json",
      "X-Chainlink-EA-AccessKey": credentials.credentials["EI_IC_ACCESSKEY"],
      "X-Chainlink-EA-Secret": credentials.credentials["EI_IC_SECRET"],
    },
    method: "POST",
  };

  // Try request with loop retries
  for (let i = 0; i < middlewareEnvInstance.SUBMIT_RETRIES; i++) {
    try {
      await axios.post(options.url, options.body, {
        timeout: 5000,
        proxy: false,
        headers: options.headers,
        httpAgent: new http.Agent({ keepAlive: false }),
      });
      return;
    } catch (err) {
      logger.error("JOB Request for " + jobId + " failed: "+  err);
    }
  }
};
