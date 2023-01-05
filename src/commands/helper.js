import fs from 'fs';
import { URL } from 'url';

/**
 * Function to read a json file
 * @param {*} filename  file name or path to read
 * @returns the JSON data in the file
 */
export const readJSONFile = (filename) => {
    let rawdata = fs.readFileSync(filename);
    let data = JSON.parse(String(rawdata));
    return data
}

/**
 * Function to read contents of a file
 * @param {*} filename file name or path to read
 * @returns the contents of the passed filename
 */
export const readFile = (filename) => {
    return fs.readFileSync(filename).toString();
}

/**
 * Function to save JSON data to a file
 * @param {*} newData new JSON data to save
 * @param {*} filename filename to save data to
 */
export const saveJSONDataToFile = (newData, filename) => {
    let data = JSON.stringify(newData);
    fs.writeFileSync(filename, data);
}  

/**
 * Function to check whether a URL is valid or not
 * @param {*} url the URL to check
 * @returns whether the url is valid or not
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
 * Function to create a delay
 * @param {*} ms milliseconds to delay
 * @returns a Promise to delay
 */
export const delay = (ms) => new Promise(res => setTimeout(res, ms));