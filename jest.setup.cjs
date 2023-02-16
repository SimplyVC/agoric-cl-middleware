import 'ses';
import fetch from 'node-fetch';
global.fetch = fetch
global.harden = (value) => value;