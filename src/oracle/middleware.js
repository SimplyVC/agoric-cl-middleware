/* eslint-disable func-names */

import { initialiseState } from '../helpers/middleware-helper.js';
import { startBridge } from './bridge.js'
import { makeController } from './controller.js'
import middlewareEnvInstance from '../helpers/middleware-env.js';
import { logger } from '../helpers/logger.js';

/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  logger.info('Starting oracle bridge');

  // Init
  await initialiseState()

  // Start the bridge
  startBridge(middlewareEnvInstance.MIDDLEWARE_PORT);

  // Calculate how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  // Start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};