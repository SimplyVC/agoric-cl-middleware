/* eslint-disable func-names */

import { 
  validUrl, 
  initialiseState, 
} from '../helpers/utils.js';
import { startBridge } from './bridge.js'
import { makeController } from './controller.js'
import { MiddlewareENV } from '../helpers/middlewareEnv.js';

// Load environment variables
let envvars = {};
try{
  envvars = new MiddlewareENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    console.log("ERROR LOADING ENV VARS", err)
    process.exit(1);
  }
}

/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  console.log('Starting oracle bridge');

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