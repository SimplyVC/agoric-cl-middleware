import fs from 'fs';
import { URL } from 'url';

export const readJSONFile = (filename) => {
    let rawdata = fs.readFileSync(filename);
    let data = JSON.parse(String(rawdata));
    return data
}

export const readFile = (filename) => {
    return fs.readFileSync(filename).toString();
}

export const saveState = (newState, filename) => {
    let data = JSON.stringify(newState);
    fs.writeFileSync(filename, data);
}  

export const validUrl = (url) => {
    try {
    	new URL(url);
      	return true;
    } catch (err) {
      	return false;
    }
};
