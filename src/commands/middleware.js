/* eslint-disable no-await-in-loop */
/* eslint-disable @jessie.js/no-nested-await */
// @ts-check
/* eslint-disable func-names */
/* global fetch, process */

/** 
 * IMPORTS
 */
import { execSwingsetTransaction } from '../lib/chain.js';
import {
  makeRpcUtils,
  boardSlottingMarshaller,
  networkConfig
} from '../lib/rpc.js'
import axios from 'axios';
import http from 'http';
import fs from 'fs';
import bodyParser from 'body-parser';
import { Far } from '@endo/far';
import { makePromiseKit } from '@endo/promise-kit';
import express from 'express';
import { validUrl, delay, saveJSONDataToFile, readJSONFile } from './helper.js';

// get environment variables
const { 
  PORT = '3000', 
  EI_CHAINLINKURL, 
  POLL_INTERVAL = '60', 
  FROM, 
  DECIMAL_PLACES = 6, 
  PRICE_DEVIATION_PERC = 1, 
  PRICE_QUERY_INTERVAL = '5',
  AGORIC_NET, 
  AGORIC_RPC = "http://0.0.0.0:26657",
  STATE_FILE = "data/middleware_state.json",
  CREDENTIALS_FILE= "config/ei_credentials.json",
  OFFERS_FILE= "config/offers.json"
} = process.env;

/** 
 * Environment variables validation
 */
assert(EI_CHAINLINKURL, '$EI_CHAINLINKURL is required');
assert(Number(DECIMAL_PLACES), '$DECIMAL_PLACES is required');
assert(Number(PRICE_DEVIATION_PERC), '$PRICE_DEVIATION_PERC is required');
assert(FROM, '$FROM is required');
assert(validUrl(AGORIC_RPC), '$AGORIC_RPC is required');
assert(STATE_FILE != "", '$STATE_FILE is required');
assert(CREDENTIALS_FILE != "", '$CREDENTIALS_FILE is required');
assert(OFFERS_FILE != "", '$OFFERS_FILE is required');

const { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });
const marshaller = boardSlottingMarshaller();

/**
 * Function to load from file or initialise it
 * @returns empty state or state from file
 */
const readState = () => {
  // try to read JSON file and if it doesnt exist, create one
  try {
    //read JSON file
    return readJSONFile(STATE_FILE)
  } catch(err) {

    //create an initial state
    let initial_state = {
      "jobs": [],
      "previous_results": {}
    }

    //save state
    saveJSONDataToFile(initial_state, STATE_FILE)
    return initial_state
  }
}

//read initiator credentials
const credentials = readJSONFile(CREDENTIALS_FILE)

//function to send a job run to the CL node
/**
 * Function to send a job run to the CL node
 * @param {*} credentials the external initiator credentials
 * @param {*} count the request id
 * @param {*} jobId the Chainlink external job id
 * @param {*} chainlinkUrl the Chainlink node url where to send the job request
 * @param {*} requestType 
 * @returns 
 */
const sendJobRun = async (credentials, count, jobId, chainlinkUrl, requestType) => {
  const options = {
      url: chainlinkUrl+"/v2/jobs/"+jobId+"/runs",
      body: {
          "payment": 0,
          "request_id": count,
          "request_type": requestType
      },
      headers: {
          "Content-Type": "application/json",
          "X-Chainlink-EA-AccessKey": credentials["EI_IC_ACCESSKEY"],
          "X-Chainlink-EA-Secret": credentials["EI_IC_SECRET"]
      },
      method: 'POST',
  };

  //try request
  //TODO: should we retry here? which codes should we retry?
  try{
      let res = await axios.post(options.url, options.body, { 
        timeout: 60000, 
        proxy:false, 
        headers: options.headers, 
        httpAgent: new http.Agent({ keepAlive: true })
      });
      return res
  }
  catch(err){
      console.error("JOB Request for "+jobId+" failed", err)
      return err
  }
  
}

/**
 * Function to query price from chain
 * @param {*} jobName job name of the price to query in the form of ATOM-USD
 * @returns the latest price
 */
const queryPrice = async (jobName) => {

  //read value from vstorage
  const capDataStr = await vstorage.readLatest(
    `published.priceFeed.${jobName}_price_feed`,
  );

  //parse the value
  var capData = JSON.parse(JSON.parse(capDataStr).value)
  capData = JSON.parse(capData.values[0])
  //replace any extra characters
  capData = JSON.parse(capData.body.replaceAll("\\", "")).quoteAmount.value[0]
  
  //get the latest price by dividing amountOut by amountIn
  var latest_price = Number(capData.amountOut.value.digits) / Number(capData.amountIn.value.digits)
  
  console.log(jobName+ " Price Query: "+ String(latest_price))
  return latest_price
}

/**
 * Function to submit a new job run to the Chainlink node
 * @param {*} state current state
 * @param {*} index the index of the job in the state data
 * @param {*} requestType the request type to send as a parameter with the job request. 1 if a timer request, 2 if triggered by a price deviation.
 */
const submitNewJobIndex = (state, index, requestType) => {

  //increment the request id of the job in the state
  state.jobs[index].request_id++;

  let request_id = state.jobs[index].request_id;
  let job = state.jobs[index].job

  console.log("Sending job spec", job, "request", request_id)
  
  //send job run
  sendJobRun(credentials, request_id, job, EI_CHAINLINKURL, requestType)
}

/**
 * Controller for the middleware
 * @param {*} intervalSeconds the poll interval at which Chainlink job runs are triggered
 * @param {*} chainlinkUrl the Chainlink node endpoint where to send requests
 * @param {*} credentials the Chainlink external initiator's credentials
 * @param {*} exiter the exiter
 * @returns a set of executable exported functions - TODO: to be removed?
 */
const makeController = (intervalSeconds, chainlinkUrl, credentials, { atExit }) => {
  const jobRequestInterval = intervalSeconds * 1_000;

  //create an interval which creates a job request every X seconds
  const it = setInterval(() => {

    //read the satte
    let state = readState();

    //for each job in state, send a job run
    for (let index in state.jobs){
      //send a job run with type 1, indicating a job run triggered from the polling interval
      submitNewJobIndex(state, index, 1)
    }
    //save state again
    saveJSONDataToFile(state, STATE_FILE)
  }, jobRequestInterval);


  const priceQueryInterval = parseInt(PRICE_QUERY_INTERVAL, 10);
  //validate polling interval
  assert(!isNaN(priceQueryInterval), `$PRICE_QUERY_INTERVAL ${PRICE_QUERY_INTERVAL} must be a number`);

  /**
   * create an interval which query the price and creates a chainlink job request 
   * if the price deviates more than a specific threshold
   */
  const it2 = setInterval(async () => {

    //read state
    let state = readState();

    //for each job in state
    for (var i = 0; i < state.jobs.length; i++) {
      //get the job name
      let jobName = state.jobs[i].name;

      //query the price
      let latest_price = await queryPrice(jobName)
      let current_price = state.previous_results[jobName].result

      //update latest price
      state.previous_results[jobName].result = latest_price
      saveJSONDataToFile(state, STATE_FILE)

      //if there's a price deviation
      let price_dev = Math.abs((latest_price - current_price)/current_price)*100
      if (price_dev > PRICE_DEVIATION_PERC) {
        console.log("Initialising new CL job request. Found a price deviation for", jobName, "of", price_dev, "%. Latest price:", latest_price," Current Price:", current_price)

        //if a request hadnt been made yet
        if (state.jobs[i].request_id == state.previous_results[jobName].request_id) {
          //submit job
          submitNewJobIndex(state, i, 2)
        }
      }
    }
  }, priceQueryInterval * 1_000);


  //on exit, clear intervals
  atExit.finally(() => { 
    clearInterval(it);
    clearInterval(it2); 
  });
  return Far('middlewareController', {
    // methods
  });
}

/**
 * Function to create a bridge which listens from the Chainlink node for
 * new jobs, job removals and job run results
 * @param {*} PORT the port to listen on
 * @param {*} exiters, bridge's exiters 
 */
const startBridge = (PORT, { atExit, exit }) => {

  console.log("Bridge started")
  const app = express();
  app.use(bodyParser.json());
  
  //read state
  let state = readState()

  /**
   * POST /adapter endpoint
   * This is used to listen for job run results
   */
  app.post('/adapter', async (req, res) => {
    //read state
    let state = readState()

    //get result
    let result = Math.round(req.body.data.result)
    //divide reuslt by decimal places
    result = Number(result) / Math.pow(10, Number(DECIMAL_PLACES))

    //get run id and type
    let request_id = String(req.body.data.request_id)
    let request_type = Number(req.body.data.request_type)
    let job_id = req.body.data.job
    let job_name = req.body.data.name
    console.log("Bridge received "+String(result)+ " for "+job_name+" (Request: "+request_id+", Type: "+request_type+")")

    //get last price from state
    let last_price = (state.previous_results[job_name]) ? state.previous_results[job_name].result : -1

    let to_update = last_price == -1 || request_type == 1
    //if last price is found and it is a price deviation request
    if (last_price != -1 && request_type == 2){
      //calculate percentage change
      let perc_change = Math.abs((result - last_price)/last_price)*100
      console.log("Price change is "+perc_change+"%. Last Price: "+String(result)+". Current Price: "+String(last_price))

      //update price if reuslt is greater than price deviation threshold
      to_update = perc_change > PRICE_DEVIATION_PERC
    }

    /**
     * If an update needs to happen
     * An update happens for the following reasons
     *    - First request
     *    - Job request was because time expired
     *    - Price deviation found
     */
    if(to_update){
      console.log("Sending price on chain!")
      console.log("Updating price!")

      //update state
      state.previous_results[job_name] = {
        id: job_id,
        result: result,
        request_id: request_id
      }
      saveState(state);

      //push price on chain
      await pushPrice(result, job_name, FROM)
    }
    
    //return a 200 code to the Chainlink node if a successful price is found
    return !isNaN(result) ? res.status(200).send({success:true}) : res.status(500).send({success:false})
  });

  /**
  * POST /jobs endpoint
  * This is used to listen for new jobs added from UI and to update state
  */
  app.post('/jobs', (req, res) => {
    let new_job = req.body.jobId;
    let new_job_name = req.body.params.name;

    //read state
    let state = readState()

    //add new job to state
    state.jobs.push({
      job: new_job,
      name: new_job_name,
      request_id: 0
    });

    //save state
    saveState(state)
    console.log("Got new job", new_job)
    console.log("new jobs", state.jobs)
    res.status(200).send({success:true})
  });

  /**
  * DELETE /jobs/:id endpoint
  * This is used to listen for jobs deleted from UI and to update state
  */
  app.delete('/jobs/:id', (req, res) => {
    let job_id = req.params.id;
    console.log("Removing job", job_id)

    //read syaye
    let state = readState()

    //loop through jobs
    for(var index in state.jobs){
      //if job is found, remove it
      if(state.jobs[index].job == job_id){
        state.jobs.splice(index, 1);
        break;
      }
    }

    //save state
    saveState(state)

    res.status(200).send({success:true})
  });

  const listener = app.listen(PORT, '0.0.0.0', () => {
    console.log(`External adapter listening on port`, PORT);
  });

  listener.on('error', err => { exit(err) })
  atExit.finally(() => { listener.close(); });
}

/**
 * Function to create an exiter
 * @returns exiters
 */
function makeExiter() {

  //TODO: This was suggested by Michael Fig, remove it?
  const exitP = makePromiseKit();
  const exit = (status = 0) => {
    if (typeof status !== 'number') {
      console.log(`Rejecting exit promise with`, status);
      exitP.reject(status);
      throw status;
    }
    console.log(`Resolving exit promise with`, status);
    exitP.resolve(status);
    return status;
  }

  return {
    exit,
    atExit: exitP.promise,
  };
}

/** @param {import('../lib/psm.js').BridgeAction} bridgeAction */
const outputAction = bridgeAction => {
  const capData = marshaller.serialize(bridgeAction);
  var data = JSON.stringify(capData)
  return data
};

/**
 * Function to push price on chain to the smart wallet
 * @param {*} price price to push
 * @param {*} feed feed to push price to
 * @param {*} from account to push from
 */
const pushPrice = async (price, feed, from) => {

  //create an offerId with the Date number
  var offerId = Date.now()

  //get offers
  let offers = readJSONFile(OFFERS_FILE)
  //get previous offer for feed
  let previousOffer = offers[feed]

  //create an offer
  const offer = {
    id: Number(offerId),
    invitationSpec: {
        source: 'continuing',
        previousOffer: Number(previousOffer),
        invitationMakerName: 'makePushPriceInvitation',
        invitationArgs: harden([String(price)]),
    },
    proposal: {},
  };
    
  //output action
  var data = outputAction({
    method: 'executeOffer',
    // @ts-ignore
    offer,
  });

  //change data to JSON
  data = JSON.parse(data)

  //create keyring
  var keyring = {
    "home": "",
    "backend": "test"
  }

  //execute
  execSwingsetTransaction(
    "wallet-action --allow-spend '"+JSON.stringify(data)+"'",
    networkConfig,
    from,
    false,
    keyring,
  );
}


/**
 * This is the function which runs the middleware
 * @returns exiter's promise
 */
export const middleware = async () => {
  console.log('Starting oracle bridge');

  const intervalSeconds = parseInt(POLL_INTERVAL, 10);
  //validate polling interval
  assert(!isNaN(intervalSeconds), `$POLL_INTERVAL ${POLL_INTERVAL} must be a number`);

  //create exiters
  const { exit, atExit } = makeExiter();
  const exiters = { exit, atExit };

  //start the bridge
  startBridge(PORT, exiters);

  //calcualte how many seconds left for a new minute
  let seconds_left = 60 - (new Date().getSeconds());

  //start the controller on the new minute
  setTimeout(() => {
    makeController(intervalSeconds, EI_CHAINLINKURL, credentials, exiters);
  }, seconds_left*1000)

  return atExit;
};
