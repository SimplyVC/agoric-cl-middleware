# Documentation

- [Oracle Network Structure](#oracle-network-structure)
- [Smart Contract Details](#smart-contract-details)
- [Aims/Objectives](#aims/objectives)
  - [Middleware](#middleware)
  - [Monitoring](#monitoring)
- [File structure](#file-structure)
- [Technical Documentation](#technical-documentation)
  - [helper.js](#helperjs)
    - [readJSONFile(filename)](#readJSONFile)
    - [saveJSONDataToFile(newData, filename)](#saveJSONDataToFile)
    - [validUrl(url)](#validUrl)
    - [delay(ms)](#delay)
  - [middleware.js](#middlewarejs)
    - [Environment Variables](#envvarsmiddleware)
    - [readState()](#readState)
    - [initialiseState()](#initialiseState)
    - [getJobIndex(jobName)](#getJobIndex)
    - [sendJobRun(credentials, count, jobId, chainlinkUrl, requestType)](#sendJobRun)
    - [getOffers(follower)](#getOffers)
    - [checkSubmissionForRound(oracle, feedOfferId, roundId)](#checkSubmissionForRound)
    - [queryPrice(feed)](#queryPrice)
    - [queryRound(feed)](#queryRound)
    - [submitNewJobIndex(index, requestType)](#submitNewJobIndex)
    - [makeController(intervalSeconds, exiter)](#makeController)
    - [startBridge(port, exiters)](#startBridge)

## Oracle Network Structure

## Smart Contract Details

## Aims/Objectives

#### Middleware

The middleware is needed to:
1. Create CL jobs. Chainlink Jobs are created every minute. A cron job is not used in order to be able to pass in particular inputs to the job run so that the progress of the request can be stored and monitored.
2. Get results back from the CL node.
3. Query smart contract for new rounds.
3. Push price updates on chain.

The middleware should contain the following functionalities:

1. A state file which is updated so that whenever the middleware is restarted it is able to continue from where it was stopped.
2. An endpoint to listen for new and removed jobs from the CL node. This is needed in order to keep a list of jobs for which the middleware has to send requests.
3. Keep a list of these jobs in its state
4. Query the price on chain and the latest round every X seconds so that a new job request is created if a new round is found
5. Send CL job requests to the CL node with parameters including a request ID and the reason for the request every Y seconds. The reason can be one of the following 3 reasons:
  a. Type 1: Time expired and a new request have to be made
  b. Type 2: A price deviation from the on-chain price was found
  c. Type 3: A new round was found
6. An endpoint to listen for results from a CL job for submitted job requests. This endpoint should decide whether or not to push the price on chain. A price should be pushed on chain if one of the following cases is satisfied:
  a. It is a new round and the oracle has not yet submitted to this round
  b. An interval of Z minutes/hours expired since the last price pushed on chain. This is only done if the oracle has not started the previous round himself. This is done because an oracle is not allowed to start consecutive rounds.
  c. There is a deviation of more than W% from the current price on-chain. Once again, only done if the oracle has not started the previous round himself.
7. Keep the following information in the state file for each feed:
  a. The CL job's external id for that feed
  b. The name of the feed
  c. The last request id
  d. The last reported round on chain
  e. The timestamp of the last request made to the CL node
  f. The last aggregated price on chain
  g. The request id of the last result received from the CL node
  h. The details of the latest on-chain round including the round id, the timestamp when it was started, by whom it was started and whether the oracle made a submission for that round

#### Monitoring

The monitoring script is needed to:
1. Monitor the actual price and that it is being updated
2. Monitor node operators submissions to ensure they are submitting values within accepatable thresholds and that they are submitting to rounds and not missing them
3. Monitor node operators' balances to ensure they have enough balance for transaction fees to push prices on chain
4. Monitor the rate at which rounds are being created

The monitoring script should contain the following functionalities:

1. A state file which is updated so that whenever the monitoring script is restarted it is able to continue from where it was stopped.
2. Monitor multiple oracles at once
3. An endpoint to expose prometheus metrics 
4. Expose the following metrics
  a. The latest submitted value on chain by an oracle for a feed
  b. The timestamp in which an oracle made an on-chain submission for a feed 
  c. The last round for which an oracle made an on-chain submission for a feed
  d. The deviation of an oracle's submitted price from the latest aggregated value on-chain for a feed
  e. The oracle balance 
  f. The actual price on-chain
4. Obtain an oracle's invitation ids for feeds from wallets
5. Query the latest prices and round submissions of oracles every X seconds and update the metrics
6. Have an efficient way of polling only the latest price pushes so be able to monitor oracles efficiently when the number of offers used start to increase


## File structure

In this section, one is able to find a description of the file structure and the contents of files

#### scripts

The scripts directory contains scripts which are used to for deployments. 

The following are the different scripts which can be found in this directory

1. accept-oracle-invitation.sh - This script can be used to accept an oracle invitation. This script takes in 3 parameters, the wallet name, the brand in and brand out. An example of a command to run this is ```./accept-oracle-invitation.sh $WALLET_NAME $BRAND_IN $BRAND_OUT```
2. get-sdk-package-names.sh - This script was copied from the agoric-sdk repository and it is used to get the sdk package names.
3. npm-audit-fix.sh - This script was copied from the agoric-sdk repository and it is used to fix issues with npm.
4. provision-wallet.sh - This script can be used to provision a smart wallet. This script takes in one parameter, the wallet name. An example of a command to run this is ```./provision-wallet.sh $WALLET_NAME```

#### src

This directory includes all the source code. It is split into two other directories, <b>oracle</b> and <b>lib</b>.

Furthermore, it contains the following two files which serve as an entry point to the middleware and monitoring script

* <b>bin-middleware.js</b> - This serves as an entry point to the middleware by calling the middleware() function
* <b>bin-monitor.js</b> - This serves as an entry point to the monitoring script by calling the getOraclesInvitations() and monitor() functions to first get the oracle invitation IDs and then starting the monitoring. 


##### oracle

This directory contains the following files

1. <b>helper.js</b> - This file contains helper functions used in middleware.js and monitor.js
2. <b>middleware.js</b> - This file contains all the necessary code and functions for the middleware
3. <b>monitor.js</b> - This file contains all the necessary code and functions for monitoring the oracle network

##### lib

This directory contains files which I cloned from the <b>agoric-sdk</b> repository and these contain functions which are used in the middleware and monitoring script.

##### docker-compose.yml

This is a docker-compose file to spin up the middleware and monitoring script

##### Dockerfile.middleware

This is a docker file to build the middleware

##### Dockerfile.monitor

This is a docker file to build the monitoring script

##### monitoring-grafana-dashboard.json

This is a Grafana template to monitor an oracle node or the whole oracle network

## Technical Documentation

In this section, I will go over the <b>oracle</b> directory and explain in detail each function in the files inside it.

<div id='helperjs'></div>

### <u>helper.js</u>

This file contains helper functions which are used both by the middleware and the monitoring script.

The file contains the following functions:

<br>
<div id='readJSONFile'></div>

<b>readJSONFile(filename)</b>

Inputs:
* filename - This is the file name or path to the file from which to read

Use: This function is used to read a JSON object from a file

Returns: The JSON contents in the file

What it does:
  1. Reads the file
  2. Parses the contents to a JSON variable
  3. Returns the variable containing the JSON object or array

<br>
<div id='saveJSONDataToFile'></div>

<b>saveJSONDataToFile(newData, filename)</b>

Inputs:
* newData - This is the JSON data to save
* filename - This is the file name or path to the file where to save data

Use: This function is used to save a JSON object/array to a file

What it does:
  1. Stringifies the data
  2. Writes the data to the file

<br>
<div id='validUrl'></div>

<b>validUrl(url)</b>

Inputs:
* url - This is the URL to check

Use: This function is used to check whether a URL is valid

Returns: A boolean showing whether it is a valid URL

What it does:
  1. Tryies to create a URL object
  2. Returns whether it is a valid URL by seeing whether the URL was successfully created or not

<br>
<div id='delay'></div>

<b>delay(ms)</b>

Inputs:
* ms - Milliseconds to delay

Use: This function is used to create a delay

Returns: A Promise with a delay of a specified number of milliseconds

<br>
<div id='middleware'></div>

### <u>middleware.js</u>

This file contains all the functions which are used both by the middleware. 

<br>
<div id='envvarsmiddleware'></div>

<b>Environment Variables</b>

This script makes use of the following environment variables and it requires them in order to function. In fact, it contains validation upon entry to make sure they are well defined.

| Variable Name        	| Description                                                                                                                                                          	| Default value              	|
|----------------------	|----------------------------------------------------------------------------------------------------------------------------------------------------------------------	|----------------------------	|
| PORT                 	| The port on which the middleware will listen <br>for job updates or results from the CL node                                                                         	| 3000                       	|
| EI_CHAINLINKURL      	| The CL node URL in order to connect to its API<br>to listen for jobs and send job requests.<br><b>Note that this has no default value and needs<br>to be defined</b> 	| N/A                        	|
| POLL_INTERVAL        	| The interval in seconds which needs to pass between<br>each CL job request                                                                                           	| 60                         	|
| PUSH_INTERVAL        	| The interval in seconds which needs to pass between<br>each round creation on-chain                                                                                  	| 600                        	|
| FROM                 	| The address of the oracle from which to push prices.<br><b>Note that this has no default value and needs<br>to be defined</b>                                        	| N/A                        	|
| DECIMAL_PLACES       	| The number of decimal places allowed for the price                                                                                                                   	| 6                          	|
| PRICE_DEVIATION_PERC 	| The price deviation percentage threshold on when <br>to create a new round on-chain                                                                                  	| 1                          	|
| SUBMIT_RETRIES       	| The number of retries to try when submitting a price<br>on-chain and it fails                                                                                        	| 3                          	|
| BLOCK_INTERVAL       	| The block time of the chain in seconds. This is used<br>to query the price and round at every interval.                                                              	| 6                          	|
| SEND_CHECK_INTERVAL  	| The interval in seconds which is waited between each send.                                                                                                           	| 12                         	|
| AGORIC_RPC           	| The Agoric's node RPC endpoint                                                                                                                                       	| http://0.0.0.0:26657       	|
| STATE_FILE           	| The path to the middleware state's file                                                                                                                              	| data/middleware_state.json 	|
| CREDENTIALS_FILE     	| The path to the file containing the credentials to the <br>CL node                                                                                                   	| config/ei_credentials.json 	|
| OFFERS_FILE          	| The path to the file containing the offers for feeds                                                                                                                 	| config/offers.json         	|


<br>
<div id='readState'></div>

<b>readState()</b>

Use: This function is used to read the middleware state from the file

Returns: The middleware's state as JSON from the file or an empty initialised state

What it does:
  1. Tries to read the file using <b>readJSONFile</b>
  2. If it succeeds, it returs the state
  3. If it fails, it initialises the state and saves it to file
  r. Returns either the state from the file or the initialised abd empty state

<br>
<div id='initialiseState'></div>

<b>initialiseState()</b>

Use: This function is used to intialise the state for each feed

What it does:
  1. Reads the state using <b>readState()</b>
  2. Goes through the jobs in the state and checks if there is a state for each job. If not, it initialises one.
  3. Saves the state to file

<br>
<div id='getJobIndex'></div>

<b>getJobIndex(jobName)</b>

Inputs:
* jobName - The job name of the job whose index is needed

Use: This function is used to get the index of the job in the array inside the state which contains all the jobs

What it does:
  1. Reads the state using <b>readState()</b>
  2. Goes through the jobs in the state and returns the index if the job name matches the one passed as input
  3. Returns -1 if the job is not found

<br>
<div id='sendJobRun'></div>

<b>sendJobRun(credentials, count, jobId, chainlinkUrl, requestType)</b>

Inputs:
* credentials - The credentials of the CL node to communicate with it
* count - The request id
* jobId - The job id to send the request to
* chainlinkUrl - The URL of the CL node where to send the request
* requestType - The type of request. The request can have the following 3 values:
  - 1 - Time interval expired. This serves a cron and depends on POLL_INTERVAL
  - 2 - Price deviation trigger. There was a price deviation greateer than PRICE_DEVIATION_PERC between the new and previous on-chain prices
  - 3 - A new round was found on-chain

Use: This function is used to send a job request to the job on CL node. If it fails, it retries for a maximum of SUBMIT_RETRIES (defined in environment variables).

What it does:
  1. Creates the request by appending the request id and the request type
  2. It loops for a maximum of SUBMIT_RETRIES and tries to submit the job to the CL node

<br>
<div id='getOffers'></div>

<b>getOffers(follower)</b>

Inputs:
* follower - Follower object containing offers and balances. This is obtained by using Agoric's functions from agoric-sdk

Use: This function is used to get the latest offers from an address

Returns: The latest offer statuses from the last 10 entries in form of an array

What it does:
  1. Reverses all the offers and loops through the reversed array
  2. If it is an offer status and it does not have an 'error' property, it is added to the array to be returned
  3. Returns the array consisting of succeeded offers.

<br>
<div id='checkSubmissionForRound'></div>

<b>checkSubmissionForRound(oracle, feedOfferId, roundId)</b>

Inputs:
* oracle - The address of the oracle
* feedOfferId - The ID of the feed offer
* roundId - The round ID to check the submission for

Use: This function is used to check whether an oracle submitted an observation for a particular round

Returns: A boolean indicating whether the oracle made a successful observation to the passed round id

What it does:
  1. Obtains a follower of offers and balances for the oracle address
  2. Gets the latest offers by calling <b>getOffers()</b> 
  3. Loops through the offers and does the following:
    a. Returns True if the offer is a 'PushPrice' offer, the feed offer ID matches to the inputted one and the offer has no error and has a matching round number.
    b. Returns False if it finds a successful 'PushPrice' offer with a round id smaller than the one passed as a parameter because a submission for an old round cannot be made. Since we are traversing offers started from the most recent one, if an offer for smaller round id is found, it is useless to continue looping as it is impossible to find an older offer for a more recent round.
  4. False is returned if the recent offers are traversed and no matching successful offer is found.


<br>
<div id='queryPrice'></div>

<b>queryPrice(feed)</b>

Inputs:
* feed - Feed name to query price for

Use: This function is used to query the latest on-chain price for a feed

Returns: The latest price

What it does:
  1. Reads the latest published price from vstorage using Agoric's functions from agoric-sdk
  2. Parses the value and returns it 
  3. If the above fails for some reason, 0 is returned. A reason for failing could be the first time a feed is created and there is no price on-chain yet
  
<br>
<div id='queryRound'></div>

<b>queryRound(feed)</b>

Inputs:
* feed - Feed name to query round for

Use: This function is used to query the latest on-chain round for a feed

Returns: The latest round in an object containing the round ID, the timestamp when it was started, who started it and whether a submission was made by the oracle running this middleware using the FROM environment variable. The result object has the following structure
```json
{
  "roundId": 1,
  "startedAt": 1612345678,
  "startedBy": "agoric123456789",
  "submissionMade": false
}
```

What it does:
  1. Reads the latest published round from vstorage using Agoric's functions from agoric-sdk
  2. Parses the values for round ID, started timestamp and who started the round
  3. Calls <b>checkSubmissionForRound</b> to check whether the oracle address running this middleware submitted to this round
  4. Appends all the details to an object and returns it

<br>
<div id='submitNewJobIndex'></div>

<b>submitNewJobIndex(index, requestType)</b>

Inputs:
* index - The index of the job in the state data
* requestType - The request type to send as a parameter with the job request. 1 if a timer request, 2 if triggered by a price deviation, 3 for a new round.

Use: This function is used to send a job request to the CL node using the index of the job in the state file

What it does:
  1. Reads the state
  2. Increments the request ID in the state file for the job using the index
  3. Sets the 'last_request_sent' timestamp to the current timestamp in the job's state
  4. Saves the updated state to the state file
  5. Calls <b>sendJobRun</b> to send a job request to the CL node


<br>
<div id='makeController'></div>

<b>makeController(intervalSeconds, exiter)</b>

<br>
<div id='makeExiter'></div>

<b>makeExiter()</b>

<br>
<div id='pushPrice'></div>

<b>pushPrice(price, feed, round, from)</b>

<br>
<div id='middleware'></div>

<b>middleware()</b>