import { logger } from "./logger.js";
import { readJSONFile } from "./utils.js";

export const FEEDS_FILE = "../config/feeds-config.json";

export class FeedsConfig {
  /**
   * Constructor for the class
   */
  constructor() {
    try {
      this.feeds = readJSONFile(FEEDS_FILE);
      this.validate();
    } catch (err) {
      logger.error("Cannot load feeds config from " + FEEDS_FILE + ": " + err);
    }
  }

  /**
   * Function to validate credentials
   */
  validate() {
    for (let feed in this.feeds) {
      let currentFeed = this.feeds[feed];
      // If no decimal places
      assert(Number(currentFeed.decimalPlaces), "No decimalPlaces in " + feed);
      // If no poll interval
      assert(Number(currentFeed.pollInterval), "No pollInterval in " + feed);
      // If no push interval
      assert(Number(currentFeed.pushInterval), "No pushInterval in " + feed);
      // If no price deviation percentage
      assert(
        Number(currentFeed.priceDeviationPerc),
        "No priceDeviationPerc in " + feed
      );
    }
  }
}
