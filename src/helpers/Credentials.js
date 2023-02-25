import { logger } from "./logger.js";
import { readJSONFile } from "./utils.js";
import { getAmountsIn, getOraclesInvitations } from "./chain.js";

export class Credentials {
  /**
   * Constructor for the class
   * @param {string} filePath file path of the oracle config
   */
  constructor(filePath) {
    try {
      this.credentials = readJSONFile(filePath);
      this.validate();
    } catch (err) {
      logger.error("Cannot load credentials from " + filePath + ": " + err);
    }
  }

  /**
   * Function to validate credentials
   */
  validate() {
    if (!("EI_IC_ACCESSKEY" in this.credentials)) {
      throw new Error("No EI_IC_ACCESSKEY in credentials");
    }
    if (!("EI_IC_ACCESSKEY" in this.credentials)) {
      throw new Error("No EI_IC_SECRET in credentials");
    }
  }
}
