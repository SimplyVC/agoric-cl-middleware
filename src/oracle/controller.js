/* eslint-disable func-names */

import { submitNewJob } from "../helpers/middleware-helper.js";
import { getAllJobs, queryTable, updateTable } from "../helpers/db.js";
import {
  queryPrice,
  queryRound,
  getLatestSubmittedRound,
} from "../helpers/chain.js";
import middlewareEnvInstance from '../helpers/middleware-env.js';
import { logger } from "../helpers/logger.js";
import { FeedsConfig } from "../helpers/feeds-config.js";

/**
 * Controller for the middleware
 */
export const makeController = () => {
  const oneSecInterval = 1_000;

  // Read feeds config
  let feeds = new FeedsConfig();

  // Create an interval which creates a job request every second
  setInterval(async () => {
    try {
      // Get all jobs
      let jobs = await getAllJobs();

      // For each job in state, send a job run
      jobs.forEach(async (job) => {
        // Get interval for feed
        let feedName = job.name;
        let pollInterval = Number(feeds.feeds[feedName].pollInterval);

        // Check whether poll interval expired
        let now = Date.now() / 1000;

        let query = await queryTable("jobs", ["last_request_sent"], feedName);
        let timeForPoll = query.last_request_sent + pollInterval <= now;

        // If interval expired
        if (timeForPoll) {
          /**
           * Send a job run with type 1, indicating a job run triggered from the
           * polling interval
           */
          await submitNewJob(feedName, 1);
        }
      });
    } catch (err) {
        logger.error("CONTROLLER ERROR: " + err);
    }
    
  }, oneSecInterval);

  const priceQueryInterval = parseInt(middlewareEnvInstance.BLOCK_INTERVAL, 10);
  
  //validate polling interval
  assert(
    !isNaN(priceQueryInterval),
    `$BLOCK_INTERVAL ${middlewareEnvInstance.BLOCK_INTERVAL} must be a number`
  );

  /**
   * create an interval which query the price and creates a Chainlink job
   * request if the price deviates more than a specific threshold
   */
  setInterval(async () => {
    try {
      // Get all jobs
      let jobs = await getAllJobs();

      // For each job
      jobs.forEach(async (job) => {
        // Get the job name
        let jobName = job.name;

        let sendRequest = 0;

        // Query the price
        let latestPrice = await queryPrice(jobName);

        // Get latest price
        let query = await queryTable("jobs", ["last_result"], jobName);

        let currentPrice = query.last_result;

        // Query latest round
        let latestRound = await queryRound(jobName, middlewareEnvInstance.FROM);

        // Get latest submitted round
        let latestSubmittedRound = await getLatestSubmittedRound(middlewareEnvInstance.FROM);

        // Update jobs table
        await updateTable(
          "jobs",
          {
            last_result: latestPrice,
            last_reported_round: latestSubmittedRound,
          },
          jobName
        );

        // Update rounds table
        await updateTable("rounds", latestRound, jobName);

        // If latest round is bigger than last reported round
        if (latestRound.roundId > latestSubmittedRound) {
          // If submitted, update last_reported_round
          if (latestRound.submissionMade) {
            await updateTable(
              "jobs",
              { last_reported_round: latestSubmittedRound },
              jobName
            );
          } else {
            // If not found, send job request
            logger.info("Found new round.");
            sendRequest = 3;
          }
        }

        // If there's a price deviation
        let priceDev =
          Math.abs((latestPrice - currentPrice) / currentPrice) * 100;

        if (priceDev > 0) {
          logger.info(
            "Found a price deviation for " +
              jobName +
              " of " +
              priceDev +
              " %. Latest price: " +
              latestPrice +
              " Current Price: " +
              currentPrice
          );
        }

        // Get feed deviation percentage threshold
        let priceDeviationPercentage = Number(
          feeds.feeds[jobName].priceDeviationPerc
        );
        if (priceDev > priceDeviationPercentage) {
          sendRequest = 2;
        }

        // If there is a request to be sent
        if (sendRequest !== 0) {
          // Get seconds now
          let secondsNow = Date.now() / 1000;

          let query = await queryTable(
            "jobs",
            ["last_request_sent", "last_received_request_id", "request_id"],
            jobName
          );

          // Check seconds passed from last request
          let secondsPassed = secondsNow - query.last_request_sent;

          /**
           * Checks if there are any pending CL job requests for which we are
           * still waiting. If so, a new CL job request should not be sent
           */
          let noPendingRequests =
            query.request_id === query.last_received_request_id;
          let enoughTimePassed =
            secondsPassed > Number(middlewareEnvInstance.SEND_CHECK_INTERVAL);

          // If a request has not been made yet and we are not waiting
          if (noPendingRequests || enoughTimePassed) {
            // Submit job
            logger.info("Initialising new CL job request");
            submitNewJob(jobName, sendRequest);
          } else {
            logger.warn(
              "Will not be initialising new job request - Still waiting for request " +
                query.request_id +
                " to finish. Last finished request is " +
                query.last_received_rsequest_id
            );
          }
        }
      });
    } catch (err) {
      logger.error("CONTROLLER ERROR: " + err);
    }
  }, priceQueryInterval * 1_000);
};
