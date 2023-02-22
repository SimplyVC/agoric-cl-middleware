import bodyParser from "body-parser";
import express from "express";
import { 
    createJob, 
    deleteJob, 
    queryTable, 
    updateTable 
} from "./db.js";
import { readJSONFile } from "./utils.js";
import { 
    pushPrice, 
    queryRound 
} from "./chain.js";

const {
  FEEDS_FILE = "../config/feeds-config.json",
  SEND_CHECK_INTERVAL = "45",
  FROM,
} = process.env;

if (process.env.NODE_ENV != "test") {
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

  //read feeds config
  let feeds = readJSONFile(FEEDS_FILE);

  /**
   * POST /adapter endpoint
   * This is used to listen for job run results
   */
  app.post("/adapter", async (req, res) => {
    //get result
    let result = Math.round(req.body.data.result);

    //get run id and type
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

    //return a 200 code to the Chainlink node if a successful price is found
    if (!isNaN(result)) {
      res.status(200).send({ success: true });
    } else {
      res.status(500).send({ success: false });
    }

    //get last price from state
    let query = await queryTable("jobs", ["last_result"], jobName);
    let lastPrice = query.last_result;

    //get push interval for feed
    let pushInterval = feeds[jobName].pushInterval;

    //check if time for update
    query = await queryTable("rounds", ["started_at"], jobName);

    let timeForUpdate =
      Date.now() / 1000 >= query.started_at + Number(pushInterval);

    /**
     * if there is no last price, if it is time for a price update or if there * is a new round, update price
     */
    let toUpdate =
      lastPrice == -1 ||
      lastPrice == 0 ||
      (requestType == 1 && timeForUpdate) ||
      requestType == 3;
    //if last price is found and it is a price deviation request
    if (lastPrice != -1 && requestType == 2) {
      //get decimal places for feed
      let decimalPlaces = feeds[jobName].decimalPlaces;
      //calculate percentage change
      lastPrice = lastPrice * Math.pow(10, Number(decimalPlaces));

      let percChange = Math.abs((result - lastPrice) / lastPrice) * 100;
      console.log(
        "Price change is " +
          percChange +
          "%. Last Price: " +
          String(result) +
          ". Current Price: " +
          String(lastPrice)
      );

      //get price deviation threshold for feed
      let priceDeviationPercentage = feeds[jobName].priceDeviationPerc;
      //update price if result is greater than price deviation threshold
      toUpdate = percChange > priceDeviationPercentage;
    }

    //get seconds since last price submission
    query = await queryTable("jobs", ["last_submission_time"], jobName);
    let timePassedSinceSubmission =
      Date.now() / 1000 - query.last_submission_time;
    //check if in submission
    let inSubmission = timePassedSinceSubmission < Number(SEND_CHECK_INTERVAL);

    /**
     * If an update needs to happen
     * An update happens for the following reasons
     *    - First request
     *    - Job request was because time expired
     *    - Price deviation found
     *    - PLUS not already waiting for a submission
     */
    if (toUpdate && !inSubmission) {
      //get latest round
      let latestRound = await queryRound(jobName);
      await updateTable("rounds", latestRound, jobName);

      //get the round for submission
      let query = await queryTable("jobs", ["last_reported_round"], jobName);
      let lastReportedRound = query.last_reported_round;
      let lastRoundId = isNaN(latestRound.round_id)
        ? lastReportedRound
        : latestRound.round_id;
      let roundToSubmit =
        lastReportedRound < lastRoundId ? lastRoundId : lastRoundId + 1;

      //check if new round
      let newRound = roundToSubmit != lastRoundId;

      /**
       * push price on chain if first round, haven't started previous round and * have not submitted yet in the same round
       */
      if (
        roundToSubmit == 1 ||
        (newRound && latestRound.started_by != FROM) ||
        (!newRound && !latestRound.submission_made)
      ) {
        console.log("Updating price for round", roundToSubmit);

        let submitted = await pushPrice(result, jobName, roundToSubmit, FROM);

        //update last reported round
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

    //update state
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
