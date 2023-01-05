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
   SUBMIT_RETRIES = 3,
   PRICE_QUERY_INTERVAL = '6',
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
 assert(Number(SUBMIT_RETRIES), '$SUBMIT_RETRIES is required');
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
  
 /**
   * Function to initialise state
   */
 const initialiseState = () => {
   //read state
   let state = readState()
 
   //go through each job
   for (let index in state.jobs){
     let currentJob = state.jobs[index]
     //if not initialised
     if (!(currentJob.name in state.previous_results)){
       state.previous_results[currentJob.name] = {
         id: currentJob.job,
         result: 0,
         round: {}
       }
     }
   }
 
   //save state
   saveJSONDataToFile(state, STATE_FILE);
 }
  
 /**
   * Function to get the job's index
   * @param {*} jobName the job name 
   * @returns the index of the job
   */
 const getJobIndex = (jobName) => {
   //read state
   let state = readState()
 
   //go through each job
   for (let index in state.jobs){
     let currentJob = state.jobs[index]
     //if not initialised
     if (currentJob.name  == jobName){
       return index
     }
   }
   return -1
 }
  
 //read initiator credentials
 const credentials = readJSONFile(CREDENTIALS_FILE)
  
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
 
    //try request with loop retries
    let error = ""
    for (let i=0; i<SUBMIT_RETRIES; i++){
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
        error = err
      }
    }
    return error
 }
  
 /**
   * Function to query price from chain
   * @param {*} jobName job name of the price to query in the form of ATOM-USD
   * @returns the latest price
   */
 const queryPrice = async (jobName) => {
  
   try{
     //read value from vstorage
     const capDataStr = await vstorage.readLatest(`published.priceFeed.${jobName}_price_feed`);
     
     //parse the value
     var capData = JSON.parse(JSON.parse(capDataStr).value)
     capData = JSON.parse(capData.values[0])
     //replace any extra characters
     capData = JSON.parse(capData.body.replaceAll("\\", ""))
 
     //get the latest price by dividing amountOut by amountIn
     var latestPrice = Number(capData.amountOut.value.digits) / Number(capData.amountIn.value.digits)
 
     console.log(jobName+ " Price Query: "+ String(latestPrice))
     return latestPrice
   }
   catch{
     return 0
   }
 }
  
 /**
   * Function to query round from chain
   * @param {*} jobName job name of the price to query in the form of ATOM-USD
   * @returns the latest round
   */
 const queryRound = async (jobName) => {
 
   //read value from vstorage
   const capDataStr = await vstorage.readLatest(
     `published.priceFeed.${jobName}_price_feed.latestRound`,
   );
 
   //parse the value
   var capData = JSON.parse(JSON.parse(capDataStr).value)
   capData = JSON.parse(capData.values[capData.values.length-1])
   //replace any extra characters
   capData = JSON.parse(capData.body.replaceAll("\\", ""))
 
   //get the latest round
   var latestRound = {
     roundId: Number(capData.roundId.digits),
     startedBy: capData.startedBy,
     submissionsBy: capData.submissionsBy
   }
   
   console.log(jobName+ " Latest Round: ",latestRound.roundId)
   return latestRound
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
 
   //increment the latest round of the job in the state
   state.jobs[index].latest_round++;
 
   let requestId = state.jobs[index].request_id;
   let job = state.jobs[index].job
 
   console.log("Sending job spec", job, "request", requestId)
 
   //update state
   saveJSONDataToFile(state, STATE_FILE)
 
   //send job run
   sendJobRun(credentials, requestId, job, EI_CHAINLINKURL, requestType)
  }
  
 /**
   * Controller for the middleware
   * @param {*} intervalSeconds the poll interval at which Chainlink job runs are triggered
   * @param {*} chainlinkUrl the Chainlink node endpoint where to send requests
   * @param {*} credentials the Chainlink external initiator's credentials
   * @param {*} exiter the exiter
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
 
       let sendRequest = 0;
 
       //query the price
       let latestPrice = await queryPrice(jobName)
       let currentPrice = jobName in state.previous_results ? state.previous_results[jobName].result : 0
 
       //query latest round
       let latestRound = await queryRound(jobName);
 
       //update latest price
       state.previous_results[jobName].result = latestPrice
       //update latest round
       state.previous_results[jobName].round = latestRound
 
       //if latest round is bigger than last reported round
       if (latestRound.roundId > state.jobs[getJobIndex(jobName)].last_reported_round){
         //if submitted, update last_reported_round
         if (latestRound.submissionsBy.includes(FROM)){
           state.jobs[getJobIndex(jobName)].last_reported_round = latestRound.roundId
         }
         //if not found send job request
         else {
           console.log("Found new round.")
           sendRequest = 3
         }
       }
 
       saveJSONDataToFile(state, STATE_FILE)
  
       //if there's a price deviation
       let price_dev = Math.abs((latestPrice - currentPrice)/currentPrice)*100
       if (price_dev > PRICE_DEVIATION_PERC) {
         sendRequest = 2
         console.log("Found a price deviation for", jobName, "of", price_dev, "%. Latest price:", latest_price," Current Price:", current_price)
       }
         
      //if there is a request to be sent
       if (sendRequest != 0) {
         //if a request hadnt been made yet
         if (state.jobs[i].request_id == state.previous_results[jobName].request_id) {
           //submit job
           console.log("Initialising new CL job request")
           submitNewJobIndex(state, i, sendRequest)
         }
       }
     }
   }, priceQueryInterval * 1_000);
  
   //on exit, clear intervals
   atExit.finally(() => { 
     clearInterval(it);
     clearInterval(it2); 
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
 
     console.log("Request from CL node");
     //get result
     let result = Math.round(req.body.data.result)
 
     //get run id and type
     let requestId = String(req.body.data.request_id)
     let requestType = Number(req.body.data.request_type)
     let jobId = req.body.data.job
     let jobName = req.body.data.name
     console.log("Bridge received "+String(result)+ " for "+jobName+" (Request: "+requestId+", Type: "+requestType+")")
 
     //update state
     state.previous_results[jobName].request_id = requestId
 
     //get last price from state
     let lastPrice = (state.previous_results[jobName]) ? state.previous_results[jobName].result : -1
 
     let toUpdate = lastPrice == -1 || requestType == 1 || requestType == 3
     //if last price is found and it is a price deviation request
     if (lastPrice != -1 && requestType == 2){
       //calculate percentage change
       lastPrice = lastPrice * Math.pow(10, Number(DECIMAL_PLACES))
       let percChange = Math.abs((result - lastPrice)/lastPrice)*100
       console.log("Price change is "+percChange+"%. Last Price: "+String(result)+". Current Price: "+String(lastPrice))
 
       //update price if result is greater than price deviation threshold
       toUpdate = percChange > PRICE_DEVIATION_PERC
     }
  
     /**
       * If an update needs to happen
       * An update happens for the following reasons
       *    - First request
       *    - Job request was because time expired
       *    - Price deviation found
       */
     if(toUpdate){
       
       //get latest queried round
       let latestRound = state.previous_results[jobName].round
 
       //get the round for submission
       let lastReportedRound = state.jobs[getJobIndex(jobName)].last_reported_round
       let lastRoundId = isNaN(latestRound.roundId) ? lastReportedRound : latestRound.roundId
       let roundToSubmit = lastReportedRound < lastRoundId ? lastRoundId : lastRoundId + 1
 
       //check if new round
       let newRound = roundToSubmit != lastRoundId
 
       //push price on chain if first round, haven't started previous round and havent submitted yet in the same round
       if (roundToSubmit == 1 || (newRound && latestRound.startedBy != FROM) || (!newRound && !latest_round.submissionsBy.includes(FROM))) {
         console.log("Updating price for round", roundToSubmit)
        await pushPrice(result, jobName, roundToSubmit, FROM)
 
         //update last reported round
         state.jobs[getJobIndex(jobName)].last_reported_round = roundToSubmit
       }  
       else {
         console.log("Already started last round or submitted to this round")
       }
     }
     
     saveJSONDataToFile(state, STATE_FILE)
     
     //return a 200 code to the Chainlink node if a successful price is found
     return !isNaN(result) ? res.status(200).send({success:true}) : res.status(500).send({success:false})
   });
  
   /**
    * POST /jobs endpoint
    * This is used to listen for new jobs added from UI and to update state
    */
   app.post('/jobs', (req, res) => {
     let newJob = req.body.jobId;
     let newJobName = req.body.params.name;
 
     //read state
     let state = readState()
 
     //add new job to state
     state.jobs.push({
       job: newJob,
       name: newJobName,
       request_id: 0,
       last_reported_round: 0
     });
 
     //add previous results
     state.previous_results[newJobName] = {
       id: newJob,
       result: 0,
       request_id: 0,
       round: {}
     }
 
     //save state
     saveJSONDataToFile(state, STATE_FILE)
     console.log("Got new job", newJob)
     console.log("new jobs", state.jobs)
     res.status(200).send({success:true})
   });
  
   /**
    * DELETE /jobs/:id endpoint
    * This is used to listen for jobs deleted from UI and to update state
    */
    app.delete('/jobs/:id', (req, res) => {
     let jobId = req.params.id;
     console.log("Removing job", jobId)
 
     //read syaye
     let state = readState()
 
     let jobName = ""
 
     //loop through jobs
     for(var index in state.jobs){
       //if job is found, remove it
       if(state.jobs[index].job == jobId){
        jobName = state.jobs[index].name
         state.jobs.splice(index, 1);
         break;
       }
     }
 
     delete state.previous_results[jobName]
 
     //save state
     saveJSONDataToFile(state, STATE_FILE)    
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
   * @param {*} round round to push result to
   * @param {*} from account to push from
   * @returns whether successful
   */
 const pushPrice = async (price, feed, round, from) => {
 
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
       invitationMakerName: 'PushPrice',
       invitationArgs: harden([{ unitPrice: price, roundId: round }]),
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
 
   let submitted = false    
 
   //loop retries
   for (let i=0; i<SUBMIT_RETRIES && !submitted; i++){
     console.log("Submitting price for round", round, "try", (i+1))
     //execute
     execSwingsetTransaction(
       "wallet-action --allow-spend '"+JSON.stringify(data)+"'",
       networkConfig,
       from,
       false,
       keyring,
     );
 
     //sleep for 10000
     await delay(Number(PRICE_QUERY_INTERVAL)*1000);
 
     //check submissions
     let latestRound = await queryRound(feed)
 
     //check if it was submitted or not
     submitted = latestRound.submissionsBy.includes(from)
   }
 
   if (submitted) {
     console.log("Price submitted successfully for round", round)
   }
   else{
     console.log("Price failed to be submitted for round", round)
   }
 
   return submitted
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
 
   //init
   initialiseState()
 
   //start the bridge
   startBridge(PORT, exiters);
 
   //calcualte how many seconds left for a new minute
   let secondsLeft = 60 - (new Date().getSeconds());
 
   //start the controller on the new minute
   setTimeout(() => {
     makeController(intervalSeconds, EI_CHAINLINKURL, credentials, exiters);
   }, secondsLeft*1000)
 
   return atExit;
 };
