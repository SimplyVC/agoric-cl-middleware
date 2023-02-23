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

const {
  FEEDS_FILE = "../config/feeds-config.json",
  SEND_CHECK_INTERVAL = "45",
  FROM,
} = process.env;

if (process.env.NODE_ENV !== "test") {
  assert(FEEDS_FILE, "$FEEDS_FILE is required");
  assert(FROM, "$FROM is required");
  assert(Number(SEND_CHECK_INTERVAL), "$SEND_CHECK_INTERVAL is required");
}

/**
 * Function to create a bridge which listens from the Chainlink node for
 * new jobs, job removals and job run results
 * @param {number} PORT the port to listen on
 */
export const startBridge = (PORT) => {
  console.log("Bridge started");
  const app = express();
  app.use(bodyParser.json());

  // Read feeds config
  let feeds = readJSONFile(FEEDS_FILE);

  /**
   * POST /adapter endpoint
   * This is used to listen for job run results
   */
  app.post("/adapter", async (req, res) => {
    // Get result
    let result = Math.round(req.body.data.result);

    // Get run id and type
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
      await updateTable("rounds", latestRound, jobName);

      // Get the round for submission
      let query = await queryTable("jobs", ["last_reported_round"], jobName);
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
      let notConsecutiveNewRound = newRound && latestRound.started_by !== FROM;
      let noSubmissionForRound = !newRound && !latestRound.submission_made

      if ( firstRound || notConsecutiveNewRound || noSubmissionForRound ) {
        console.log("Updating price for round", roundToSubmit);

        let submitted = await pushPrice(result, jobName, roundToSubmit, FROM);

        // Update last reported round
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

    // Update state
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
