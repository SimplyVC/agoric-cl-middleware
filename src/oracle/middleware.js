/* eslint-disable func-names */

import { 
  validUrl, 
  initialiseState, 
} from '../helpers/utils.js';
import { startBridge } from './bridge.js'
import { makeController } from './controller.js'

// Get environment variables
const {
  PORT = '3000',
  AGORIC_RPC = "http://0.0.0.0:26657",
} = process.env;

/** 
  * Environment variables validation
  */
if (process.env.NODE_ENV !== "test"){
  assert(Number(PORT), "$PORT is required");
  assert(validUrl(AGORIC_RPC), '$AGORIC_RPC is required');
}

/**
  * This is the function which runs the middleware
  */
export const middleware = async () => {
  console.log('Starting oracle bridge');

  // Init
  await initialiseState()

  // Start the bridge
  startBridge(PORT);

  // Calculate how many seconds left for a new minute
  let secondsLeft = 60 - (new Date().getSeconds());

  // Start the controller on the new minute
  setTimeout(() => {
    makeController();
  }, secondsLeft * 1000)
};