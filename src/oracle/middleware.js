/* eslint-disable func-names */

import { initialiseState, } from '../helpers/utils.js';
import { startBridge } from './bridge.js'
import { makeController } from './controller.js'
import { MiddlewareENV } from '../helpers/middlewareEnv.js';
import { logger } from '../helpers/logger.js';

// Load environment variables
let envvars = {};
try{
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    logger.error("ERROR LOADING ENV VARS", err)
    process.exit(1);
  }
}

/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  logger.info('Starting oracle bridge');

  // Init
  await initialiseState()

  // Start the bridge
  startBridge(envvars.PORT);

  // Calculate how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  // Start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};