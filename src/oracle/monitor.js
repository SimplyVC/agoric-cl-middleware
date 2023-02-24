import {
  boardSlottingMarshaller,
  makeRpcUtils,
  networkConfig,
} from "../lib/rpc.js";
import { makeFollower, makeLeader } from "@agoric/casting";
import {
  readJSONFile,
  saveJSONDataToFile,
} from "../helpers/utils.js";
import { getCurrent } from "../lib/wallet.js";
import { Registry, Gauge } from "prom-client";
import { createServer } from "http";
import { parse } from "url";
import { iterateReverse } from "@agoric/casting";
import { logger } from "../helpers/logger.js";


let envvars = {};
try{
  envvars = new MonitorENV();
} catch (err) {
  if (process.env.NODE_ENV !== "test") {
    logger.error("ERROR LOADING ENV VARS: " + err)
    process.exit(1);
  }
}

// Create a Registry which registers the metrics
const register = new Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: "agoric-cl-oracle-monitor",
});

// Create gauge for value
const oracleSubmission = new Gauge({
  name: "oracle_latest_value",
  help: "Latest value submitted by oracle",
  labelNames: ["oracleName", "oracle", "feed"],
});

// Create gauge for timestamp
const oracleLastEpoch = new Gauge({
  name: "oracle_last_observation",
  help: "Last epoch in which oracle made an observation",
  labelNames: ["oracleName", "oracle", "feed"],
});

// Create gauge for last round
const oracleLastRound = new Gauge({
  name: "oracle_last_round",
  help: "Last round in which oracle made an observation",
  labelNames: ["oracleName", "oracle", "feed"],
});

// Create gauge for price deviation
const oracleDeviation = new Gauge({
  name: "oracle_price_deviation",
  help: "Latest price deviation by oracle",
  labelNames: ["oracleName", "oracle", "feed"],
});

// Create gauge for balance
const oracleBalance = new Gauge({
  name: "oracle_balance",
  help: "Oracle balances",
  labelNames: ["oracleName", "oracle", "brand"],
});

// Create gauge for last price
const actualPriceGauge = new Gauge({
  name: "actual_price",
  help: "Actual last price from feed",
  labelNames: ["feed"],
});

// Register the gauges
register.registerMetric(oracleSubmission);
register.registerMetric(oracleLastEpoch);
register.registerMetric(oracleLastRound);
register.registerMetric(oracleBalance);
register.registerMetric(oracleDeviation);
register.registerMetric(actualPriceGauge);

const { agoricNames, fromBoard, vstorage } = await makeRpcUtils({ fetch });

// This holds the offer ids
let feeds = [];
// This holds the amounts in
let amountsIn = {};

/**
 * Function to read oracles
 * @returns {Object[]} oracles, their names and their addresses
 */
const readOracleAddresses = () => {
  return readJSONFile(envvars.ORACLE_FILE);
};

/**
 * Function to get oracles feed invitations
 */
export const getOraclesInvitations = async () => {
  // Get the feeds
  feeds = agoricNames.reverse;

  // For each oracle
  for (let oracle in oracles) {
    const current = await getCurrent(oracle, fromBoard, { vstorage });
    const invitations = current.offerToUsedInvitation;

    // For each invitation
    for (let inv in invitations) {
      let boardId = invitations[inv].value[0].instance.boardId;
      let feed = feeds[boardId].split(" price feed")[0];

      if (!("feeds" in oracles[oracle])) {
        oracles[oracle]["feeds"] = {};
      }
      // Add feed
      oracles[oracle]["feeds"][String(inv)] = feed;
    }
  }
};

// Let oracleLabels = readOracles();
let oracles = readOracleAddresses();


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
const updateMetrics = (
  oracleName,
  oracle,
  feed,
  value,
  id,
  actualPrice,
  lastRound
) => {
  // Calculate price deviation from actual value
  let priceDeviation = Math.abs((value - actualPrice) / actualPrice) * 100;

  oracleSubmission.labels(oracleName, oracle, feed).set(value);
  oracleLastEpoch.labels(oracleName, oracle, feed).set(id);
  oracleLastRound.labels(oracleName, oracle, feed).set(lastRound);
  oracleDeviation.labels(oracleName, oracle, feed).set(priceDeviation);
  actualPriceGauge.labels(feed).set(actualPrice);
};

/**
 * Function to update balance metrics
 * @param {*} oracleName oracle name
 * @param {*} oracle oracle address
 * @param {*} brand brand
 * @param {*} value balance value to set
 */
const updateBalanceMetrics = (oracleName, oracle, brand, value) => {
  oracleBalance.labels(oracleName, oracle, brand).set(value);
};

/**
 * Function to query price for feed
 * @param {*} feed feed like 'BRAND_IN-BRAND_OUT'
 * @returns the price of the feed
 */
const queryPrice = async (feed) => {
  try {
    const capDataStr = await vstorage.readLatest(
      `published.priceFeed.${feed}_price_feed`
    );

    //parse the value
    let capData = JSON.parse(JSON.parse(capDataStr).value);
    capData = JSON.parse(capData.values[0]);

    // Replace any extra characters
    capData = JSON.parse(capData.body.replaceAll("\\", ""));

    // Get the latest price by dividing amountOut by amountIn
    let latestPrice =
      Number(capData.amountOut.value.digits) /
      Number(capData.amountIn.value.digits);
    amountsIn[feed] = Number(capData.amountIn.value.digits);

    logger.info(feed + " Price Query: " + String(latestPrice));
    actualPriceGauge.labels(feed).set(latestPrice);
    return latestPrice;
  } catch (err) {
    logger.error("Price could not be obtained");
    return 0;
  }
};

/**
 * Function to get offers and balances
 * @param {*} follower offers and balances
 * @param {*} oracle oracle address
 * @returns an object containing the offers and balances
 */
const getOffersAndBalances = async (follower, oracle) => {
  let toReturn = {
    offers: [],
    balances: [],
  };
  let counter = 0;
  let lastVisited = 0;

  for await (const followerElement of iterateReverse(follower)) {
    if (counter === 10) {
      break;
    }

    // If it is an offer status
    if (followerElement.value.updated === "offerStatus") {
      // Get id
      let id = followerElement.value.status.id;

      // If a new and final state
      if (id !== lastVisited) {
        // If it is not failed
        if (!followerElement.value.status.hasOwnProperty("error")) {
          toReturn["offers"].push(followerElement.value);
          counter++;
        }
        lastVisited = id;
      }
    }
  }

  // Get current purses
  let current = await getCurrent(oracle, fromBoard, { vstorage });
  for (let i = 0; i < current.purses.length; i++) {
    let currentPurse = current.purses[i];
    toReturn["balances"].push(currentPurse.balance);
  }

  return toReturn;
};

/**
 * Function to get the latest prices for an oracle
 * @param {*} oracle oracle address
 * @param {*} oracleDetails oracle details
 * @param {*} state oracle's latest state
 * @returns last results including the oracle submitted price
 */
export const getLatestPrices = async (oracle, oracleDetails, state) => {
  // Get feeds for oracle
  let feeds = oracleDetails["feeds"];
  logger.info("Getting prices for "+ oracle + " - " + JSON.stringify(feeds));

  const unserializer = boardSlottingMarshaller(fromBoard.convertSlotToVal);
  const leader = makeLeader(networkConfig.rpcAddrs[0]);

  const follower = await makeFollower(`:published.wallet.${oracle}`, leader, {
    unserializer,
  });

  let offersBalances = await getOffersAndBalances(follower, oracle);

  // Get last offer id from offers from state
  let lastOfferId = isNaN(state["last_offer_id"]) ? 0 : state["last_offer_id"];

  // Initialise variable to hold results
  let lastResults = {
    last_offer_id: lastOfferId,
    values: state["values"] ? state["values"] : {},
  };

  // Loop through offers starting from last visited index
  for (let i = 0; i < offersBalances.offers.length; i++) {
    // Get current offer
    let currentOffer = offersBalances.offers[i];
    let id = Number(currentOffer["status"]["id"]);

    // If we found the last visited offer id in previous check, stop looping
    if (id <= lastOfferId) {
      break;
    }

    // If a price invitation
    let invMakerName = currentOffer["status"]["invitationSpec"][
    "invitationMakerName"]

    if ( invMakerName === "PushPrice" ) {
      let feed =
        feeds[currentOffer["status"]["invitationSpec"]["previousOffer"]];
      let lastRound = Number(
        currentOffer["status"]["invitationSpec"]["invitationArgs"][0]["roundId"]
      );

      // Get feeds last observed round from state
      let lastObservedRound = state["values"].hasOwnProperty(feed)
        ? state["values"][feed]["round"]
        : 0;

      // If round is bigger than last observed and the offer didn't fail
      if (
        lastRound > lastObservedRound &&
        !currentOffer["status"].hasOwnProperty("error")
      ) {
        // If id is bigger than last offer id in state, set it
        lastResults["last_offer_id"] = id;
        lastOfferId = id

        let price =
          Number(
            currentOffer["status"]["invitationSpec"]["invitationArgs"][0][
              "unitPrice"
            ]
          ) / amountsIn[feed];

        // Fill results variable
        lastResults["values"][feed] = {
          price: price,
          id: id,
          round: lastRound,
        };
        state = lastResults;

        // Get latest feed price
        let feedPrice = await queryPrice(feed);
        // Update metrics
        updateMetrics(
          oracleDetails["oracleName"],
          oracle,
          feed,
          price,
          id,
          feedPrice,
          lastRound
        );
      }
    }
  }

  // Loop through balances
  for (let i = 0; i < offersBalances.balances.length; i++) {
    let currentBalance = offersBalances.balances[i];

    let brand = currentBalance.brand.iface.split(" ")[1];
    if (brand.includes("BLD") || brand.includes("IST")) {
      let value = Number(currentBalance.value);
      updateBalanceMetrics(oracleDetails["oracleName"], oracle, brand, value);
    }
  }

  return lastResults["last_offer_id"] !== lastOfferId ? lastResults : state;
};

/**
 * Function to read the latest monitoring state from file
 * @returns latest monitoring state
 */
const readMonitoringState = () => {
  // Try to read from file
  try {
    return readJSONFile(envvars.STATE_FILE);
  } catch (err) {
    // If it fails, initialise and save
    let initialState = {};

    for (let oracle in oracles) {
      initialState[oracle] = {
        last_index: 0,
        values: {},
      };
    }

    // Save to file
    saveJSONDataToFile(initialState, envvars.STATE_FILE);
    return initialState;
  }
};

/**
 * Main function to monitor
 */
export const monitor = async () => {
  // Create interval
  setInterval(async () => {
    await getOraclesInvitations();
    // Read monitoring state
    let state = readMonitoringState();

    // For each oracle
    for (let oracle in oracles) {
      // Check if there is state for oracle
      if (!(oracle in state)) {
        state[oracle] = {
          last_offer_id: 0,
          values: {},
        };
      }

      // Get latest prices for oracle
      let latestOracleState = await getLatestPrices(
        oracle, oracles[oracle], state[oracle]
      );
      state[oracle] = latestOracleState;
    }

    // Update state
    saveJSONDataToFile(state, envvars.STATE_FILE);
  }, envvars.POLL_INTERVAL * 1000);
};

/**
 * Creates the server for the metrics endpoint
 */
const startServer = () => {
  // Define the HTTP server
  const server = createServer(async (req, res) => {
    // Retrieve route from request object
    const route = parse(req.url).pathname;

    if (route === "/metrics") {
      // Return all metrics the Prometheus exposition format
      res.setHeader("Content-Type", register.contentType);
      res.end(await register.metrics());
    }
  });

  server.listen(envvars.PORT);
};

startServer();
