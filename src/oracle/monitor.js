import { createServer } from "http";
import { parse } from "url";
import { logger } from "../helpers/logger.js";
import { getOracleLatestInfo } from "../helpers/chain.js";
import { MonitorMetrics } from "../helpers/monitor-metrics.js";
import { OracleMonitorConfig } from "../helpers/oracle-monitor-config.js";
import { MonitoringState } from "../helpers/monitoring-state.js";
import monitorEnvInstance from "../helpers/monitor-env.js";
import { FeedsConfig } from "../helpers/feeds-config.js";

let metrics = new MonitorMetrics();
let oracleConfig = new OracleMonitorConfig(monitorEnvInstance.ORACLE_FILE);
let state = new MonitoringState(
  monitorEnvInstance.MONITOR_STATE_FILE,
  oracleConfig
);
let feedsConfig = new FeedsConfig();

/**
 * Main function to monitor
 */
export const monitor = async () => {
  // Holds last round details
  let lastRound = {};

  // Loop through feeds from config
  for (let feed in feedsConfig.feeds) {
    // Set config metrics
    metrics.setConfigMetrics(
      feed,
      feedsConfig.feeds[feed].priceDeviationPerc,
      feedsConfig.feeds[feed].pushInterval
    );

    lastRound[feed] = {
      round: 0,
      submissions: [],
    };
  }

  // Create interval
  setInterval(async () => {
    try {
      oracleConfig.getInvsForOracles();

      // Read monitoring state
      state.readMonitoringState(oracleConfig);

      // For each oracle
      for (let oracle in oracleConfig.oracles) {
        // Check if there is no state for oracle
        if (!(oracle in state.state)) {
          state.initialiseStateForOracle(oracle);
        }

        // Get latest prices for oracle
        let latestOracleState = await getOracleLatestInfo(
          oracle,
          oracleConfig.oracles[oracle],
          state.state[oracle],
          metrics,
          oracleConfig.amountsIn
        );

        // For each feed in result
        for (let feed in latestOracleState.values) {
          let feedState = latestOracleState.values[feed];

          // Check if round is greater than in memory variable
          if (feedState.round > lastRound[feed].round) {
            // Reset variable
            lastRound[feed] = {
              round: feedState.round,
              submissions: [feedState.id]
            };
          } else if (feedState.round == lastRound[feed].round) {
            // Otherwise add submission time to array
            if (!lastRound[feed].submissions.includes(feedState.id)) {
              lastRound[feed].submissions.push(feedState.id);
            }
          }
        }

        state.updateOracleState(oracle, latestOracleState);
      }
 
      // Once all oracles were queried, get consensus time for each feed
      for (let feed in lastRound) {
        let feedLastRound = lastRound[feed];

        // If there were at least  3 submissions
        if (feedLastRound.submissions.length >= 3) {
          // First sort the array
          feedLastRound.submissions.sort((a, b) => a - b);
          // Calculate consensus time, subtract third time from first
          let consensusTime =
            feedLastRound.submissions[2] - feedLastRound.submissions[0];
          // Update metric
          metrics.updateConsensusTimeTaken(feed, consensusTime);
        }
      }
    } catch (err) {
      logger.error("MONITOR ERROR: " + err);
    }
  }, monitorEnvInstance.MONITOR_POLL_INTERVAL * 1000);
};

/**
 * Creates the server for the metrics endpoint
 */
const startServer = () => {
  // Define the HTTP server
  const server = createServer(async (req, res) => {
    // Retrieve route from request object
    const route = parse(req.url).pathname;

    if (route === "/metrics") {
      // Return all metrics the Prometheus exposition format
      res.setHeader("Content-Type", metrics.register.contentType);
      res.end(await metrics.register.metrics());
    }
  });

  server.listen(monitorEnvInstance.MONITOR_PORT);
};

startServer();
