import bodyParser from "body-parser";
import express from "express";
import { 
    createJob, 
    deleteJob, 
    queryTable, 
    updateTable 
} from "../helpers/db.js";
import { 
    checkForPriceUpdate, 
    readJSONFile 
} from "../helpers/utils.js";
import { 
    pushPrice, 
    queryRound 
} from "../helpers/chain.js";
import { MiddlewareENV } from '../helpers/middlewareEnv.js';
import { logger } from "../helpers/logger.js";

// Load environment variables
let envvars = {};
try{
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    logger.error("ERROR LOADING ENV VARS: " + err)
    process.exit(1);
  }
}

/**
 * Function to create a bridge which listens from the Chainlink node for
 * new jobs, job removals and job run results
 * @param {number} PORT the port to listen on
 */
export const startBridge = (PORT) => {
  logger.info("Bridge started");
  const app = express();
  app.use(bodyParser.json());

  /**
   * POST /adapter endpoint
   * This is used to listen for job run results
   */
  app.post("/adapter", async (req, res) => {
    try {
      // Get result
      let result = Math.round(req.body.data.result);

      // Get run id and type
      let requestId = String(req.body.data.request_id);
      let requestType = Number(req.body.data.request_type);
      let jobName = req.body.data.name;
      logger.info(
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

      // Return a 200 code to the Chainlink node if a successful price is received
      if (isNaN(result)) {
        res.status(500).send({ success: false });
      } else {
        res.status(200).send({ success: true });
      }

      // Check if a price update should be made
      let toUpdate = await checkForPriceUpdate(jobName, requestType, result)

      if (toUpdate) {
        // Get latest round
        let latestRound = await queryRound(jobName);

        try {
          await updateTable("rounds", latestRound, jobName);
        } catch (err) {
          throw new Error(
            "Error when updating table rounds for " +
            jobName +
              " in /adapter"
          );
        }

        // Get the round for submission
        let query;
        try {
          query = await queryTable("jobs", ["last_reported_round"], jobName);
        } catch (err) {
          throw new Error(
            "Error when querying jobs for last_reported_round for " +
              jobName +
              " in /adapter"
          );
        }

        let lastReportedRound = query.last_reported_round;
        let lastRoundId = isNaN(latestRound.round_id)
          ? lastReportedRound
          : latestRound.round_id;
        let roundToSubmit =
          lastReportedRound < lastRoundId ? lastRoundId : lastRoundId + 1;

        // Check if new round
        let newRound = roundToSubmit !== lastRoundId;

        /**
         * Push price on chain if:
         *  - First round
         *  - Have not started previous round 
         *  - Have not submitted yet in the same round
         */
        let firstRound = roundToSubmit === 1;
        let notConsecutiveNewRound = 
        newRound && latestRound.started_by !== envvars.FROM;
        let noSubmissionForRound = !newRound && !latestRound.submission_made

        if ( firstRound || notConsecutiveNewRound || noSubmissionForRound ) {
          logger.info("Updating price for round " + roundToSubmit);

          let submitted = 
          await pushPrice(result, jobName, roundToSubmit, envvars.FROM);

          // Update last reported round
          if (submitted) {
            try {
              await updateTable(
                "jobs",
                { last_reported_round: roundToSubmit },
                jobName
              );
            } catch (err) {
              throw new Error(
                "Error when updating table jobs for " +
                jobName +
                  " in /adapter"
              );
            }
          }
        } else {
          logger.info("Already started last round or submitted to this round");
        }
      }

      // Update state
      try {
        await updateTable(
          "jobs",
          { last_received_request_id: Number(requestId) },
          jobName
        );
      } catch (err) {
        throw new Error(
          "Error when updating table jobs for " +
          jobName +
            " in /adapter"
        );
      }
      
    } catch (err) {
      logger.error("SERVER ERROR: " + err);
      res.status(500).send({ success: false });
    }
    
  });

  /**
   * POST /jobs endpoint
   * This is used to listen for new jobs added from UI and to update state
   */
  app.post("/jobs", async (req, res) => {
    try {
      let newJob = req.body.jobId;
      let newJobName = req.body.params.name;
      logger.info("new job " + newJobName + " " + newJob);
  
      await createJob(newJob, newJobName);
  
      res.status(200).send({ success: true });
    } catch (err) {
      logger.error("SERVER ERROR: " + err);
      res.status(500).send({ success: false });
    }
  });

  /**
   * DELETE /jobs/:id endpoint
   * This is used to listen for jobs deleted from UI and to update state
   */
  app.delete("/jobs/:id", async (req, res) => {
    try {
      let jobId = req.params.id;
      logger.info("Removing job " + jobId);
  
      await deleteJob(jobId);
  
      res.status(200).send({ success: true });
    } catch (err) {
      logger.error("SERVER ERROR: " + err);
      res.status(500).send({ success: false });
    }
  });

  const listener = app.listen(PORT, "0.0.0.0", () => {
    logger.info("External adapter listening on port " + PORT);
  });

  listener.on("error", (err) => {
    logger.error("Bridge error: " + err);
  });
};
