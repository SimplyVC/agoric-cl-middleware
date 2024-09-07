import fs from 'fs';
import { URL } from "url";
import { logger } from "./logger.js";
import axios from "axios";

/**
 * Function to read a json file
 * @param {string} filename  file name or path to read
 * @returns {object} the JSON data in the file
 */
export const readJSONFile = (filename) => {
  let rawData = fs.readFileSync(filename);
  return JSON.parse(String(rawData));
};

/**
 * Function to save JSON data to a file
 * @param {object} newData new JSON data to save
 * @param {string} filename filename to save data to
 */
export const saveJSONDataToFile = (newData, filename) => {
  let data = JSON.stringify(newData);
  fs.writeFileSync(filename, data);
};

/**
 * Function to create a delay
 * @param {number} ms milliseconds to delay
 * @returns {Promise} a Promise to delay
 */
export const delay = async (ms) => {
  return new Promise(async (res) => await setTimeout(res, ms));
};

/**
   * Function to check if a file exists
   * @param {string} path filepath
   * @returns {boolean} true if file exists, false otherwise
   */
export const checkFileExists = (path) => {
  try {
    fs.accessSync(path, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Function to check whether a URL is valid or not
 * @param {string} url the URL to check
 * @returns {boolean} whether the url is valid or not
 */
export const validUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Function to get coingecko prices for provided ids
 * @param {string[]} coingeckoIds list of coingecko ids
 * @returns {object} response with prices for each id
 */
export const getCoingeckoPrices = async (coingeckoIds) => {
  const ids = Object.values(coingeckoIds)
      .filter(value => value !== undefined)
      .join(', ');

  const response = await axios.get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&page=1&sparkline=false&locale=en&ids=${ids}`);

  return response.data;
};

/**
 * Function to check if enough minutes passed
 * @param {number} timestamp timestamp to check
 * @param {number} minutes number of minutes to check if passed
 * @returns true if minutes passed from timestamp
 */
export const hasMinutesPassed = (timestamp, minutes) => {
  minutes = minutes * 60 * 1000; // minutes in milliseconds
  const currentTime = Date.now(); // Get the current time in milliseconds
  return currentTime - timestamp >= minutes;
}
