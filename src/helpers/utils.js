import fs from 'fs';
import { URL } from "url";
import { logger } from "./logger.js";

/**
 * Function to read a json file
 * @param {string} filename  file name or path to read
 * @returns {object} the JSON data in the file
 */
export const readJSONFile = (filename) => {
  try {
    let rawData = fs.readFileSync(filename);
    return JSON.parse(String(rawData));
  } catch (err) {
    logger.error(`Failed to read JSON file ${filename}: ${err}`);
    process.exit(1)
  }
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

