import { validUrl, checkFileExists } from "./utils.js";
import { logger } from "./logger.js";

class MiddlewareENV {
  constructor() {
    const {
      MIDDLEWARE_PORT = "3000",
      AGORIC_RPC = "http://0.0.0.0:26657",
      FROM,
      SUBMIT_RETRIES = "3",
      SEND_CHECK_INTERVAL = "45",
      BLOCK_INTERVAL = "6",
      EI_CHAINLINKURL,
      CREDENTIALS_FILE = "config/ei_credentials.json",
      DB_FILE = "data/database.db",
    } = process.env;

    this.MIDDLEWARE_PORT = MIDDLEWARE_PORT;
    this.AGORIC_RPC = AGORIC_RPC;
    this.FROM = FROM;
    this.SUBMIT_RETRIES = SUBMIT_RETRIES;
    this.SEND_CHECK_INTERVAL = SEND_CHECK_INTERVAL;
    this.BLOCK_INTERVAL = BLOCK_INTERVAL;
    this.EI_CHAINLINKURL = EI_CHAINLINKURL;
    this.CREDENTIALS_FILE = CREDENTIALS_FILE;
    this.DB_FILE = DB_FILE;

    this.validate();
  }

  /**
   * This function validates the env vars
   */
  validate() {
    assert(!isNaN(Number(this.MIDDLEWARE_PORT)), "$MIDDLEWARE_PORT should be a valid number");
    assert(
      !isNaN(Number(this.SUBMIT_RETRIES)),
      "$SUBMIT_RETRIES should be a valid number"
    );
    assert(
      !isNaN(Number(this.SEND_CHECK_INTERVAL)),
      "$SEND_CHECK_INTERVAL should be a valid number"
    );
    assert(
      !isNaN(Number(this.BLOCK_INTERVAL)),
      "$BLOCK_INTERVAL should be a valid number"
    );
    assert(this.FROM && this.FROM !== "", "$FROM is required");
    assert(validUrl(this.EI_CHAINLINKURL), "$EI_CHAINLINKURL is required");
    assert(
      checkFileExists(this.CREDENTIALS_FILE),
      "$CREDENTIALS_FILE does not exist"
    );
    assert(checkFileExists(this.DB_FILE), "$DB_FILE does not exist");
  }
}

// Load environment variables
let middlewareEnvInstance = {};
try {
  middlewareEnvInstance = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test" && process.env.SERVICE !== "monitor") {
    logger.error("ERROR LOADING ENV VARS: " + err);
    process.exit(1);
  }
}

export default middlewareEnvInstance;
