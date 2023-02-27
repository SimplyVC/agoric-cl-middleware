import { createServer } from "http";
import { parse } from "url";
import { logger } from "../helpers/logger.js";
import { getOracleLatestInfo } from "../helpers/chain.js";
import { MonitorMetrics } from "../helpers/MonitorMetrics.js";
import { OracleMonitorConfig } from "../helpers/OracleMonitorConfig.js";
import { MonitoringState } from "../helpers/MonitoringState.js";

let metrics = new MonitorMetrics();
let oracleConfig = new OracleMonitorConfig(monitorEnvInstance.ORACLE_FILE);
let state = new MonitoringState(monitorEnvInstance.MONITOR_STATE_FILE, oracleConfig);

/**
 * Main function to monitor
 */
export const monitor = async () => {
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
          state.initialiseStateForOracle(oracle)
        }

        // Get latest prices for oracle
        let latestOracleState = await getOracleLatestInfo(
          oracle,
          oracleConfig.oracles[oracle],
          state.state[oracle],
          metrics,
          oracleConfig.amountsIn
        );
        state.updateOracleState(latestOracleState)
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

  server.listen(monitorEnvInstance.PORT);
};

startServer();
