import { logger } from "./logger.js";
import { readJSONFile } from "./utils.js";
import { getAmountsIn, getOraclesInvitations } from "./chain.js";

export class OracleMonitorConfig {
  /**
   * Constructor for the class
   * @param {string} filePath file path of the oracle config
   */
  constructor(filePath) {
    try {
      this.oracles = readJSONFile(filePath);
      this.amountsIn = {};
      this.validate();

      //get invitations
      this.getInvsForOracles();
    } catch (err) {
      logger.error(`Cannot load OracleMonitorConfig from ${filePath}: ${err}`);
    }
  }

  /**
   * Function to validate oracle configs
   */
  validate() {
    for (let oracle in this.oracles) {
      let currentOracle = this.oracles[oracle];

      // If no oracle name
      if (!("oracleName" in currentOracle)) {
        throw new Error("No oracleName in oracle details");
      }
    }
  }

  /**
   * Function to get feed invitations for multiple oracles
   */
  async getInvsForOracles() {

    // Loop through oracles
    for (let oracle in this.oracles) {
      let invitations = await getOraclesInvitations(oracle);

      // Loop through invitations
      for (let feed in invitations) {
        if (!("feeds" in this.oracles[oracle])) {
          this.oracles[oracle]["feeds"] = {};
        }

        // Add feed
        this.oracles[oracle]["feeds"][invitations[feed]] = feed;

        // If feed is not in amountsIn
        if (!(feed in this.amountsIn)) {
          try {
            this.amountsIn[feed] = await getAmountsIn(feed);
          } catch {
            logger.error("Failed to get AmountsIn, make sure there is a price for the feed")
          }
        }
      }
    }
  }
}
