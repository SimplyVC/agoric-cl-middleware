import { logger } from "./logger.js";
import { OracleMonitorConfig } from "./oracle-monitor-config.js";
import { saveJSONDataToFile, readJSONFile } from "./utils.js";

export class MonitoringState {
  /**
   * Constructor for class
   * @param {string} filePath file path for the state file
   * @param {OracleMonitorConfig} oracleConfig config
   */
  constructor(filePath, oracleConfig) {
    try {
      this.stateFile = filePath;
      this.readMonitoringState(oracleConfig);
      this.validate();
    } catch (err) {
      logger.error(`Cannot load MonitoringState from ${filePath}: ${err}`);
    }
  }

  /**
   * Function to read the latest monitoring state from file
   * @param {OracleMonitorConfig} oracleConfig config
   */
  readMonitoringState(oracleConfig) {
    // Try to read from file
    try {
      this.state = readJSONFile(this.stateFile);
    } catch (err) {
      // If it fails, initialise and save
      let initialState = {};

      for (let oracle in oracleConfig.oracles) {
        initialState[oracle] = {
          last_index: 0,
          values: {},
        };
      }

      // Save to file
      saveJSONDataToFile(initialState, this.stateFile);
      this.state = initialState;
    }
  }

  /**
   * Function to initialise state for oracle
   * @param {string} oracle oracle address to initialise state for
   */
  initialiseStateForOracle(oracle) {
    this.state[oracle] = {
      last_index: 0,
      values: {},
    };
    saveJSONDataToFile(this.state, this.stateFile);
  }

  /**
   * Function to update state for oracle
   * @param {string} oracle oracle address to initialise state for
   * @param {object} newState new state to set
   */
  updateOracleState(oracle, newState) {
    this.state[oracle] = newState;
    saveJSONDataToFile(this.state, this.stateFile);
  }

  /**
   * Function to validate monitoring state
   */
  validate() {
    for (let oracle in this.state) {
      let currentOracle = this.state[oracle];

      // If no last_index
      if (!("last_index" in currentOracle)) {
        throw new Error(`No last_index in ${oracle}'s state`);
      }
      if (!("values" in currentOracle)) {
        throw new Error(`No values in ${oracle}'s state`);
      }

      //if there is a last_index there should be values
      if (currentOracle.last_index !== 0) {
        //loop through feeds and confirm they have all fields
        for (let feed in currentOracle.value) {
          if (!("price" in currentOracle.values[feed])) {
            throw new Error(`No price for ${feed} in ${oracle}'s state`);
          }
          if (!("id" in currentOracle.values[feed])) {
            throw new Error(`No id for ${feed} in ${oracle}'s state`);
          }
          if (!("round" in currentOracle.values[feed])) {
            throw new Error(`No round for ${feed} in ${oracle}'s state`);
          }
        }
      }
    }
  }
}
