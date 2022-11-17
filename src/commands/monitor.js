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
import { coalesceWalletState } from '@agoric/smart-wallet/src/utils.js';
import { validUrl, readJSONFile, readFile, saveState } from './helper.js'
import { getCurrent } from '../lib/wallet.js';
import { Registry, Gauge } from 'prom-client';
import { createServer } from 'http';
import { parse } from 'url';

const { PORT = '3001', POLL_INTERVAL = '10', AGORIC_NET, AGORIC_RPC = "http://0.0.0.0:26657" } = process.env;
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
  labelNames: ['oracle', 'feed']
})

//Create gauge for timestamp
const oracleObservation = new Gauge({
    name: 'oracle_last_observation',
    help: 'Last epoch in which oracle made an observation',
    labelNames: ['oracle', 'feed']
  })

//Create gauge for price deviation
const oracleDeviation = new Gauge({
    name: 'oracle_price_deviation',
    help: 'Latest price deviation by oracle',
    labelNames: ['oracle', 'feed']
  })
  
//Create gauge for balance
const oracleBalance = new Gauge({
    name: 'oracle_balance',
    help: 'Oracle balances',
    labelNames: ['oracle', 'brand']
  })

//Create gauge for last price
const actualPrice = new Gauge({
    name: 'actual_price',
    help: 'Actual last price from feed',
    labelNames: ['feed']
  })

// Register the gaugex
register.registerMetric(oracleSubmission)
register.registerMetric(oracleObservation)
register.registerMetric(oracleBalance)
register.registerMetric(oracleDeviation)
register.registerMetric(actualPrice)

const { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });

var feeds = []

const STATE_FILE = "data/monitoring_state.json"
const ORACLE_FILE = "config/oracles.txt"

const readOracleAddresses = () => {
    var fileInput = readFile(ORACLE_FILE)
    var addresses = fileInput.split(",")
    var oracles = {}
    for (let addr of addresses) {
      addr = addr.replaceAll("\n", "")
      oracles[addr] = {}
    }
    return oracles
}

var oracles = readOracleAddresses();

const updateMetrics = (oracle, feed, value, id, actual_price) => {
   let price_deviation = Math.abs((value - actual_price)/actual_price)*100

    oracleSubmission.labels(oracle, feed).set(value)
    oracleObservation.labels(oracle, feed).set(id)
    oracleDeviation.labels(oracle, feed).set(price_deviation)
    actualPrice.labels(feed).set(actual_price)
}

const updateBalanceMetrics = (oracle, brand, value) => {
    oracleBalance.labels(oracle, brand).set(value)
}

const queryPrice = async (job_name) => {
    const capDataStr = await vstorage.readLatest(
      `published.priceFeed.${job_name}_price_feed`,
    );
  
    var capData = JSON.parse(JSON.parse(capDataStr).value)
    capData = JSON.parse(capData.values[0])
    capData = JSON.parse(capData.body.replaceAll("\\", "")).quoteAmount.value[0]
    
    var latest_price = Number(capData.amountOut.value.digits) / Number(capData.amountIn.value.digits)
    console.log(job_name+ " Price Query: "+ String(latest_price))
    actualPrice.labels(job_name).set(latest_price)
    return latest_price
  }

export const getLatestPrices = async (oracle, feeds, last_index) => {

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
    const coalesced = await coalesceWalletState(follower);
    let offers = Array.from(coalesced.offerStatuses.values());
    let balances = Array.from(coalesced.balances.values());

    let last_results = {
        "last_index": last_index,
        "values": {}
    }

    last_index = (last_index > offers.length) ? 0 : last_index;
 
    for (var i=last_index; i<offers.length; i++){
        var current_offer = offers[i];
        last_results["last_index"] = i;

        if (current_offer["invitationSpec"]["invitationMakerName"] == "makePushPriceInvitation"){
            let feed = feeds[current_offer["invitationSpec"]["previousOffer"]]
            let price = Number(current_offer["invitationSpec"]["invitationArgs"])
            let id = Number(current_offer["id"])
            last_results["values"][feed] = {
                price: price,
                id: id
            }
            let feed_price = await queryPrice(feed)
            updateMetrics(oracle, feed, price, id, feed_price)
        }
    }

    //loop through balances
    for (var i=0; i < balances.length; i++){
        let current_balance = balances[i]
        var brand = current_balance.brand.iface.split(" ")[1]
        if (brand.includes("BLD") || brand.includes("IST")){
            var value = Number(current_balance.value)
            updateBalanceMetrics(oracle, brand, value)
        }
    }

    return last_results
}

export const getOraclesInvitations = async() => {
    for (let key in agoricNames.instance) {
        if(key.includes("price feed")){
            let feed = key.split(" price feed")[0]
            let boardId = agoricNames.instance[key].boardId
            feeds.push({
                feed: feed,
                boardId: boardId
            })
        }
    }
    feeds = agoricNames.reverse

    for (let oracle in oracles){

        const current = await getCurrent(oracle, fromBoard, {
            vstorage,
        });

        const invitations = current.offerToUsedInvitation
 

        for (let inv in invitations) {

           let boardId = invitations[inv].value[0].instance.boardId
           let feed = feeds[boardId].split(" price feed")[0]
           oracles[oracle][String(inv)] = feed
        }
    }

    
    console.log(oracles)
}

const readMonitoringState = () => {
    try{
        return readJSONFile(STATE_FILE)
    }catch(err) {
        let initial_state = {}

        for (let oracle in oracles){
            initial_state[oracle] = {
                    "last_index": 0,
                    "values": {}
             }
        }

        saveState(initial_state, STATE_FILE)
        return initial_state
    }
}

export const monitor = async() => {

    let state = readMonitoringState()
    setInterval(async () => {

        
        //for each oracle
        for (let oracle in oracles){

            //check if there is state for oracle
            if (!(oracle in state)){
                state[oracle] = {
                    "last_index": 0,
                    "values": {}
                }
            }
            console.log("ORACLE STATE", state[oracle])

            let latest_oracle_state = await getLatestPrices(oracle, oracles[oracle], state[oracle]["last_index"])
            state[oracle] = latest_oracle_state
        }

        saveState(state, STATE_FILE)

    }, POLL_INTERVAL*1000);
}

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
