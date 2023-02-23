import fs from 'fs';
import { URL } from "url";

export class MonitorENV {
  constructor() {
    const {
      PORT = "3001",
      POLL_INTERVAL = "10",
      AGORIC_NET,
      AGORIC_RPC = "http://0.0.0.0:26657",
      STATE_FILE = "data/monitoring_state.json",
      ORACLE_FILE = "config/oracles.json", 
    } = process.env;

    this.PORT = PORT;
    this.POLL_INTERVAL = POLL_INTERVAL;
    this.AGORIC_NET = AGORIC_NET;
    this.AGORIC_RPC = AGORIC_RPC;
    this.STATE_FILE = STATE_FILE;
    this.ORACLE_FILE = ORACLE_FILE;

    this.validate();
  }

  /**
   * This function validates the env vars
   */
  validate() {
    assert(Number(this.PORT), "$PORT should be a valid number");
    assert(Number(this.POLL_INTERVAL), "$POLL_INTERVAL is required");
    assert(this.AGORIC_NET && this.AGORIC_NET != "", "$AGORIC_NET is required");
    assert(this.checkFileExists(this.ORACLE_FILE), "$ORACLE_FILE does not exist")
    assert(this.validUrl(this.AGORIC_RPC), "$AGORIC_RPC is not valid")
  }

  /**
   * Function to check if a file exists
   * @param {string} path filepath
   * @returns {boolean} if it exists
   */
  checkFileExists(path) {
    try {
      fs.accessSync(path, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Function to check whether a URL is valid or not
   * @param {string} url the URL to check
   * @returns {boolean} whether the url is valid or not
   */
  validUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (err) {
      return false;
    }
  };
}