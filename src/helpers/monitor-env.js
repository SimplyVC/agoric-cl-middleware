import { validUrl, checkFileExists } from "./utils.js";
import { logger } from "./logger.js";

class MonitorENV {
  constructor() {
    const {
      MONITOR_PORT = "3001",
      MONITOR_POLL_INTERVAL = "10",
      AGORIC_NET,
      AGORIC_RPC = "http://0.0.0.0:26657",
      MONITOR_STATE_FILE = "data/monitoring_state.json",
      ORACLE_FILE = "config/oracles.json",
    } = process.env;

    this.MONITOR_PORT = MONITOR_PORT;
    this.MONITOR_POLL_INTERVAL = MONITOR_POLL_INTERVAL;
    this.AGORIC_NET = AGORIC_NET;
    this.AGORIC_RPC = AGORIC_RPC;
    this.MONITOR_STATE_FILE = MONITOR_STATE_FILE;
    this.ORACLE_FILE = ORACLE_FILE;

    this.validate();
  }

  /**
   * This function validates the env vars
   */
  validate() {
    assert(!isNaN(Number(this.MONITOR_PORT)), "$MONITOR_PORT should be a valid number");
    assert(
      !isNaN(Number(this.MONITOR_POLL_INTERVAL)),
      "$POLL_INTERVAL is required"
    );
    assert(
      this.AGORIC_NET && this.AGORIC_NET !== "",
      "$AGORIC_NET is required"
    );
    assert(checkFileExists(this.ORACLE_FILE), "$ORACLE_FILE does not exist");
    assert(validUrl(this.AGORIC_RPC), "$AGORIC_RPC is not valid");
  }
}

let monitorEnvInstance = {};
try {
  monitorEnvInstance = new MonitorENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test" && process.env.SERVICE === "monitor") {
    logger.error("ERROR LOADING ENV VARS: " + err);
    process.exit(1);
  }
}

export default monitorEnvInstance;
