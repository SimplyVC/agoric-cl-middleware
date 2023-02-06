import { Command } from 'commander';
import { inspect } from 'util';
import {
    boardSlottingMarshaller,
    makeRpcUtils,
    storageHelper,
    networkConfig
} from '../lib/rpc.js';
import {
    makeFollower,
    makeLeader,
} from '@agoric/casting';
import { validUrl, readJSONFile, saveJSONDataToFile } from './helper.js'
import { getCurrent } from '../lib/wallet.js';
import { Registry, Gauge } from 'prom-client';
import { createServer } from 'http';
import { parse } from 'url';
import { iterateReverse } from '@agoric/casting';

const { 
    PORT = '3001', 
    POLL_INTERVAL = '10', 
    AGORIC_NET, 
    AGORIC_RPC = "http://0.0.0.0:26657" ,
    STATE_FILE = "data/monitoring_state.json",
    ORACLE_FILE = "config/oracles.json",
} = process.env;

assert(!isNaN(Number(PORT)), '$PORT is required');
assert(!isNaN(Number(POLL_INTERVAL)), '$POLL_INTERVAL is required');
assert(validUrl(AGORIC_RPC), '$AGORIC_RPC is required');
assert(AGORIC_NET != "" && AGORIC_NET != null, '$AGORIC_NET is required');

// Create a Registry which registers the metrics
const register = new Registry()

// Add a default label which is added to all metrics
register.setDefaultLabels({
    app: 'agoric-cl-oracle-monitor'
})

//Create gauge for value
const oracleSubmission = new Gauge({
    name: 'oracle_latest_value',
    help: 'Latest value submitted by oracle',
    labelNames: ['oracleName', 'oracle', 'feed']
})

//Create gauge for timestamp
const oracleObservation = new Gauge({
    name: 'oracle_last_observation',
    help: 'Last epoch in which oracle made an observation',
    labelNames: ['oracleName', 'oracle', 'feed']
})

//Create gauge for last round
const oracleLastRound = new Gauge({
    name: 'oracle_last_round',
    help: 'Last round in which oracle made an observation',
    labelNames: ['oracleName', 'oracle', 'feed']
})

//Create gauge for price deviation
const oracleDeviation = new Gauge({
    name: 'oracle_price_deviation',
    help: 'Latest price deviation by oracle',
    labelNames: ['oracleName', 'oracle', 'feed']
})

//Create gauge for balance
const oracleBalance = new Gauge({
    name: 'oracle_balance',
    help: 'Oracle balances',
    labelNames: ['oracleName', 'oracle', 'brand']
})

//Create gauge for last price
const actualPriceGauge = new Gauge({
    name: 'actual_price',
    help: 'Actual last price from feed',
    labelNames: ['feed']
})

// Register the gaugex
register.registerMetric(oracleSubmission)
register.registerMetric(oracleObservation)
register.registerMetric(oracleLastRound)
register.registerMetric(oracleBalance)
register.registerMetric(oracleDeviation)
register.registerMetric(actualPriceGauge)

const { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });

//this holds the offer ids
var feeds = []
//this holds the amounts in
var amountsIn = {}

/**
 * Function to read oracles
 * @returns oracles, their names and their addresses
 */
const readOracleAddresses = () => {
    var oracles = readJSONFile(ORACLE_FILE)
    return oracles
}

/**
 * Function to get oracles feed invitations
 */
export const getOraclesInvitations = async () => {
    //get the feeds
    feeds = agoricNames.reverse

    //for each oracle
    for (let oracle in oracles) {

        const current = await getCurrent(oracle, fromBoard, { vstorage });
        const invitations = current.offerToUsedInvitation

        //for each invitation
        for (let inv in invitations) {
            let boardId = invitations[inv].value[0].instance.boardId
            let feed = feeds[boardId].split(" price feed")[0]

            if (!("feeds" in oracles[oracle])) {
                oracles[oracle]["feeds"] = {}
            }
            //add feed
            oracles[oracle]["feeds"][String(inv)] = feed
        }
    }
}

//var oracleLabels = readOracles();
var oracles = readOracleAddresses();
await getOraclesInvitations();

/**
 * Function to update metrics
 * @param {*} oracleName oracle name
 * @param {*} oracle oracle address
 * @param {*} feed feed name
 * @param {*} value new feed value
 * @param {*} id submission id which is a timestamp
 * @param {*} actualPrice feed actual aggregated price
 * @param {*} lastRound latest round id for which there was a submission
 */
const updateMetrics = (oracleName, oracle, feed, value, id, actualPrice, lastRound) => {
    //calculate price deviation from actual value
    let priceDeviation = Math.abs((value - actualPrice) / actualPrice) * 100

    oracleSubmission.labels(oracleName, oracle, feed).set(value)
    oracleObservation.labels(oracleName, oracle, feed).set(id)
    oracleLastRound.labels(oracleName, oracle, feed).set(lastRound)
    oracleDeviation.labels(oracleName, oracle, feed).set(priceDeviation)
    actualPriceGauge.labels(feed).set(actualPrice)
}

/**
 * Function to update balance metrics
 * @param {*} oracleName oracle name
 * @param {*} oracle oracle address
 * @param {*} brand brand
 * @param {*} value balance value to set
 */
const updateBalanceMetrics = (oracleName, oracle, brand, value) => {
    oracleBalance.labels(oracleName, oracle, brand).set(value)
}

/**
 * Function to query price for feed
 * @param {*} feed feed like 'BRAND_IN-BRAND_OUT'
 * @returns the price of the feed
 */
const queryPrice = async (feed) => {
    try {
        const capDataStr = await vstorage.readLatest(
            `published.priceFeed.${feed}_price_feed`,
        );

        //parse the value
        var capData = JSON.parse(JSON.parse(capDataStr).value)
        capData = JSON.parse(capData.values[0])
        //replace any extra characters
        capData = JSON.parse(capData.body.replaceAll("\\", ""))

        //get the latest price by dividing amountOut by amountIn
        var latestPrice = Number(capData.amountOut.value.digits) / Number(capData.amountIn.value.digits)
        amountsIn[feed] = Number(capData.amountIn.value.digits)

        console.log(feed + " Price Query: " + String(latestPrice))
        actualPriceGauge.labels(feed).set(latestPrice)
        return latestPrice

    }
    catch (err) {
        console.log("Price could not be obtained")
        return 0
    }

}

/**
  * Function to get offers and balances
  * @param {*} follower offers and balances
  * @param {*} oracle oracle address
  * @returns an object containing the offers and balances
  */
const getOffersAndBalances = async (follower, oracle) => {

    let toReturn = {
        offers: [],
        balances: []
    };
    let counter = 0;

    for await (const followerElement of iterateReverse(follower)) {

        if (counter == 10){
          break;
        }
    
        //if it is an offer status 
        if (followerElement.value.updated == "offerStatus"){
          //get id
          let id = followerElement.value.status.id
    
          //if a new and final state
          if (id != lastVisited) {
            //if it is not failed
            if (!followerElement.value.status.hasOwnProperty("error")) {
              history.push(followerElement.value);
            }
            counter++
          } 
        }
    }

    //get current purses
    let current = await getCurrent(oracle, fromBoard, { vstorage })
    for (let i = 0; i < current.purses.length; i++) {
        let currentPurse = current.purses[i]
        toReturn["balances"].push(currentPurse.balance);
    }

    return toReturn
}

/**
 * Function to get latest prices for oracle
 * @param {*} oracle oracle address
 * @param {*} oracleDetails oracle details
 * @param {*} state oracle's latest state
 * @returns last results including the oracle submitted price
 */
export const getLatestPrices = async (oracle, oracleDetails, state) => {

    //get feeds for oracle
    let feeds = oracleDetails["feeds"]
    console.log("Getting prices for", oracle, feeds)

    const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
    const leader = makeLeader(networkConfig.rpcAddrs[0]);

    const follower = await makeFollower(
        `:published.wallet.${oracle}`,
        leader,
        {
            // @ts-expect-error xxx
            unserializer,
        },
    );

    let offersBalances = await getOffersAndBalances(follower, oracle)

    //get last offer id from offers from state
    let lastOfferId = isNaN(state["last_offer_id"]) ? 0 : state["last_offer_id"]

    //initialise variable to hold results
    let lastResults = {
        "last_offer_id": lastOfferId,
        "values": state["values"] ? state["values"] : {}
    }

    //loop through offers starting from last visited index
    for (var i = 0; i < offersBalances.offers.length; i++) {

        //get current offer
        var currentOffer = offersBalances.offers[i];
        let id = Number(currentOffer["status"]["id"])

        //if we found the last visited offer id in previous check, stop looping
        console.log("lastOfferId", lastOfferId, "currentId", id)
        if (id <= lastOfferId) {
            break
        }

        //if a price invitation
        if (currentOffer["status"]["invitationSpec"]["invitationMakerName"] == "PushPrice") {

            let feed = feeds[currentOffer["status"]["invitationSpec"]["previousOffer"]]
            let lastRound = Number(currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"])

            //get feeds last observed round from state
            let lastObservedRound = state["values"].hasOwnProperty(feed) ? state["values"][feed]["round"] : 0

            //if round is bigger than last observed and the offer didn't fail
            if (lastRound > lastObservedRound && !currentOffer["status"].hasOwnProperty("error")) {

                //if id is bigger than last offer id in state, set it
                lastResults["last_offer_id"] = id

                let price = Number(currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["unitPrice"]) / amountsIn[feed]

                //fill results variable
                lastResults["values"][feed] = {
                    price: price,
                    id: id,
                    round: lastRound
                }
                state = lastResults

                //get latest feed price
                let feedPrice = await queryPrice(feed)
                //update metrics
                updateMetrics(oracleDetails["oracleName"], oracle, feed, price, id, feedPrice, lastRound)

            }
        }
    }

    //loop through balances
    for (var i = 0; i < offersBalances.balances.length; i++) {
        let currentBalance = offersBalances.balances[i]

        var brand = currentBalance.brand.iface.split(" ")[1]
        if (brand.includes("BLD") || brand.includes("IST")) {
            var value = Number(currentBalance.value)
            updateBalanceMetrics(oracleDetails["oracleName"], oracle, brand, value)
        }
    }

    return lastResults["last_offer_id"] != lastOfferId ? lastResults : state
}

/**
 * Function to read the latest monitoring state from file
 * @returns latest monitoring state
 */
const readMonitoringState = () => {
    //try to read from file
    try {
        return readJSONFile(STATE_FILE)
    } catch (err) {
        //if it fails, initialise and save
        let initialState = {}

        for (let oracle in oracles) {
            initialState[oracle] = {
                "last_index": 0,
                "values": {}
            }
        }

        //save to file
        saveJSONDataToFile(initialState, STATE_FILE)
        return initialState
    }
}

/**
 * Main function to monitor
 */
export const monitor = async () => {

    //create interval
    setInterval(async () => {

        //read monitoring state
        let state = readMonitoringState()

        //for each oracle
        for (let oracle in oracles) {

            //check if there is state for oracle
            if (!(oracle in state)) {
                state[oracle] = {
                    "last_offer_id": 0,
                    "values": {}
                }
            }
            console.log("ORACLE STATE", oracle, state[oracle])

            //get latest prices for oracle
            let latestOracleState = await getLatestPrices(oracle, oracles[oracle], state[oracle])
            state[oracle] = latestOracleState
        }

        //update state
        saveJSONDataToFile(state, STATE_FILE)

    }, POLL_INTERVAL * 1000);
}

/**
 * Creates the server for the metrics endpoint
 */
const startServer = () => {
    // Define the HTTP server
    const server = createServer(async (req, res) => {

        // Retrieve route from request object
        const route = parse(req.url).pathname

        if (route === '/metrics') {
            // Return all metrics the Prometheus exposition format
            res.setHeader('Content-Type', register.contentType)
            res.end(await register.metrics())
        }
    });

    server.listen(PORT)

}

startServer()