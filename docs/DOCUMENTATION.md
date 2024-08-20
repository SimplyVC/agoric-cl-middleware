# Documentation

- [Technical Documentation](#technical-documentation)
  - [helpers/chain.js](#chainjs)
    - [getLatestBlockHeight()](#getLatestBlockHeight)
    - [readVStorage(feed, roundData)](#readvstorage)
    - [getOffers(follower)](#getOffers)
    - [getLatestSubmittedRound(oracle, feedOfferId)](#getLatestSubmittedRound)
    - [checkSubmissionForRound(oracle, feedOfferId, roundId)](#checkSubmissionForRound)
    - [queryPrice(feed)](#queryPrice)
    - [getOraclesInvitations(oracle)](#getOraclesInvitationsMiddleware)
    - [queryRound(feed, oracle)](#queryRound)
    - [pushPrice(price, feed, round, from)](#pushPrice)
    - [getOffersAndBalances(follower, oracle)](#getOffersAndBalances)
    - [getAmountsIn(feed)](#getAmountsIn)
    - [getOracleLatestInfo(oracle, oracleDetails, state, metrics, amountsIn)](#getOracleLatestInfo)
  - [helpers/chainlink.js](#chainlinkjs)
    - [sendJobRun(count, jobId, requestType)](#sendJobRun)
  - [helpers/db.js](#dbjs)
    - [loadDB()](#loadDB)
    - [createDBs()](#createDBs)
    - [getAllJobs()](#getAllJobs)
    - [createJob(id, name)](#createJob)
    - [deleteJob(id)](#deleteJob)
    - [queryTable(table, fields, name)](#queryTable)
    - [updateTable(table, values, name)](#updateTable)
    - [getNextSequence()](#getNextSequence)
    - [incrementSequence()](#incrementSequence)
  - [helpers/utils.js](#helperjs)
    - [readJSONFile(filename)](#readJSONFile)
    - [saveJSONDataToFile(newData, filename)](#saveJSONDataToFile)
    - [delay(ms)](#delay)
    - [checkFileExists(path)](#checkFileExists)
    - [validUrl(url)](#validUrl)
  - [helpers/middleware-helper.js](#middlewarehelperjs)
    - [initialiseState()](#initialiseState)
    - [submitNewJob(feed, requestType)](#submitNewJob)
    - [checkIfInSubmission(feed)](#checkIfInSubmission)
    - [checkForPriceUpdate(jobName, requestType)](#checkForPriceUpdate)
  - [helpers/credentials.js](#credentialsjs)
    - [Properties](#credentialsproperties)
    - [constructor(filePath)](#constructorCredentials)
    - [validate()](#validateCredentials)
  - [helpers/feeds-config.js](#feedsconfigjs)
    - [Properties](#feedsconfigproperties)
    - [constructor()](#constructorFeedsconfig)
    - [validate()](#validateFeedsconfig)
  - [helpers/middleware-env.js](#middlewareenvjs)
    - [Properties](#middlewareenvproperties)
    - [constructor()](#constructorMiddlewareenv)
    - [validate()](#validateMiddlewareenv)
  - [helpers/monitor-env.js](#monitorenvjs)
    - [Properties](#monitorenvproperties)
    - [constructor()](#constructorMonitorenv)
    - [validate()](#validateMonitorenv)
  - [helpers/monitor-metrics.js](#monitormetricsjs)
    - [Metrics](#metrics)
    - [constructor()](#constructorMonitormetrics)
    - [updateMetrics(oracleName, oracle, feed, value, id, actualPrice, lastRound, roundsCreated)](#updateMetrics)
    - [updateBalanceMetrics(oracleName, oracle, feed, value)](#updateBalanceMetrics)
    - [setConfigMetrics(feed, threshold, heartbeat)](#setConfigMetrics)
    - [updateConsensusTimeTaken(feed, consensusTime)](#updateConsensusTimeTaken)
  - [helpers/monitoring-state.js](#monitoringstatejs)
    - [Properties](#monitoringstateproperties)
    - [constructor(filePath, oracleConfig)](#constructorMonitoringstate)
    - [validate()](#validateMonitoringstate)
    - [readMonitoringState(oracleConfig)](#readMonitoringState)
    - [initialiseStateForOracle(oracle)](#initialiseStateForOracle)
    - [updateOracleState(oracle, newState)](#updateOracleState)
  - [helpers/oracle-monitor-config.js](#oraclemonitorconfigjs)
    - [Properties](#omcproperties)
    - [constructor(filePath)](#constructorOraclemonitorconfig)
    - [validate()](#validateOraclemonitorconfig)
    - [getInvsForOracles()](#getInvsForOracles)
  - [helpers/round-details.js](#rounddetailsjs)
    - [Properties](#rounddetailsproporties)
    - [constructor(roundId, startedAt, startedBy, submissionMade)](#constructorRoundDetails)
    - [toObject()](#toObject)
  - [oracle/controller.js](#controllerjs)
    - [makeController()](#makeController)
  - [oracle/bridge.js](#bridgejs)
    - [startBridge(port)](#startBridge)
      - [POST /adapter](#postadapter)
      - [POST /jobs](#postjobs)
      - [DELETE /jobs/:id](#deljobs)
  - [oracle/middleware.js](#middlewarejs)
    - [Environment Variables](#envvarsmiddleware)
    - [middleware()](#middlewarefunc)
  - [oracle/monitor.js](#monitorjs)
    - [Environment Variables](#envvarsmonitor)
    - [startServer()](#startServer)
    - [monitor()](#monitorfunc)


## Technical Documentation

In this section, I will go over the <b>oracle</b> directory and explain in detail each function in the files inside it.


<div id='chainjs'></div>

### <u>helpers/chain.js</u>

<br>
<div id='getLatestBlockHeight'></div>

<b>getLatestBlockHeight()</b>

Use: This function is used to get the last block height and whether the node is still syncing

Returns: The latest block height and whether it is still syncing or 0 and true if it fails.

<br>
<div id='readvstorage'></div>

<b>readVStorage(feed, roundData)</b>

Inputs:
* feed - The feed name
* roundData - A boolean indicating whether we are reading round data. A false means we are reading price data

Use: This function is used read price or round data from vstorage

Returns: CapDataString by calling vstorage.readLatest().

<br>
<div id='getOffers'></div>

<b>getOffers(follower)</b>

Inputs:
* follower - Follower object containing offers and balances. This is obtained by using Agoric's functions from agoric-sdk

Use: This function is used to get the latest offers from an address

Returns: The latest offer statuses from the last 5 entries in form of an array

What it does:
  1. Reverses all the offers and loops through the reversed array
  2. If it is an offer status and it does not have an 'error' property, it is added to the array to be returned
  3. Returns the array consisting of succeeded offers.

<br>
<div id='getLatestSubmittedRound'></div>

<b>getLatestSubmittedRound(oracle, feedOfferId)</b>

Inputs:
* oracle - The address of the oracle of whom we are getting the latest submitted round
* feedOfferId - The offer ID of the feed to get the latest round for

Use: This function is used to get the latest round for which a submission was made

Returns: The latest round ID for which a submission was made

What it does:
  1. Obtains a follower of offers and balances for the oracle address
  2. Gets the latest offers by calling <b>getOffers()</b> 
  3. Returns the round ID of the latest offer

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
      1. Returns True if the offer is a 'PushPrice' offer, the feed offer ID matches to the inputted one and the offer has no error and has a matching round number.
      2. Returns False if it finds a successful 'PushPrice' offer with a round id smaller than the one passed as a parameter because a submission for an old round cannot be made. Since we are traversing offers started from the most recent one, if an offer for smaller round id is found, it is useless to continue looping as it is impossible to find an older offer for a more recent round.
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
  3. If the above fails for some reason, -1 is returned. A reason for failing could be the first time a feed is created and there is no price on-chain yet
  

<br>
<div id='getOraclesInvitationsMiddleware'></div>

<b>getOraclesInvitations(oracle)</b>

Inputs:
* oracle - Oracle address to get invitations for

Use: This function is used to get the oracle invitation IDs for price feeds 

Returns: A JSON object with invitation IDs as below
```json
{
  "ATOM-USD": "123456789",
  "OSMO-USD": "987654321"
}
```

What it does:
  1. Loops through each oracle to monitor and obtain their invitation IDs for feeds
  2. The invitations IDs are returned in a JSON objects with the keys being the feed names and the values being the invitation IDs



<br>
<div id='queryRound'></div>

<b>queryRound(feed, oracle)</b>

Inputs:
* feed - Feed name to query round for
* oracle - oracle address to get submission for

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
<div id='pushPrice'></div>

<b>pushPrice(price, feed, round, from)</b>

Inputs:
* price - The price to push
* feed - The feed to push the price to
* round - The round to push the price to
* from - The oracle address from where to push the price

Use: This function is used to push a price on chain for a specific feed and round

Returns: A boolean indicating whether the push submission was successful or not

What it does:
  1. Creates an ID for the offer. The ID is a timestamp
  2. Obtains the feed offer id from the wallet using <b>getOraclesInvitations()</b>
  3. Creates an offer object with the feed offer id, the created id, the price and the round
  4. It checks whether a submission for this round was already made to avoid double submissions to save transaction fees.
  5. Check if the middleware is waiting for a price submission confirmation using checkIfInSubmission()
  6. If a submission is not yet made and it is not waiting for a submission confirmation, it will loop for a maximum of SUBMIT_RETRIES and it will do the following:
      1. Queries the latest round
      2. Confirms whether the round we are submitting to is actually the latest round and that we have not sent a submission for this round yet
      3. If the above condition is satisfied, the offer is pushed on chain
      4. It will delay for SEND_CHECK_INTERVAL. This is done to ensure that the price is not still in the mempool and that two blocks (13 seconds in this case) have passed just in case.
      5. Check whether the submission was successful. If the submission was not successful after 2 blocks, the loop continues for next try.
      6. Once the loop finishes and all the tries were done, true or false will be returned indicating whether the price was successfully pushed or not

<br>
<div id='getOffersAndBalances'></div>

<b>getOffersAndBalances(follower, oracle)</b>

Inputs:
* follower - A list of offers and balances for an oracle
* oracle - The oracle address

Use: This function is used to obtain the most recent offers and balances for an oracle

Returns: An object containing a list of the most recent offers and balances in the form below
```json
{
  "offers": [],
  "balances": []
}
```

What it does:
  1. Gets offers by calling getOffers()
  2. Gets the balances using getCurrent and pushes them to array of balances
  3. Returns the object with both offers and balances arrays


<br>
<div id='getAmountsIn'></div>

<b>getAmountsIn(feed)</b>

Inputs:
* feed - The feed name to get amount in for it

Use: This function is used to obtain the amountIn value to obtain the price for a feed

Returns: A number which is used to divide the output from CapData to get the actual price

What it does:
  1. Reads vstorage and gets the amountIn

<br>
<div id='getOracleLatestInfo'></div>

<b>getOracleLatestInfo(oracle, oracleDetails, state, metrics, amountsIn)</b>

Inputs:
* oracle - The oracle address
* oracleDetails - The oracle details, including the feeds
* state - Latest oracle state
* metrics - Metrics object to update metrics
* amountsIn - Object of amountsIn for every feed to be used to calculate the price

Use: This function is used to obtain the latest submission details for an oracle

Returns: An object containing details of the last submission for each feed in the form below
```json
{
  "ATOM-USD": {
    "price": 10.01,
    "id": 15712345678,
    "round": 1
  }
}
```

What it does:
  1. Gets the latest offers and balances for the oracle using <b>getOffersAndBalances</b>
  2. Gets the last visited offer ID from the state in order not to loop through offers which were already examined in previous checks
  3. Loops through each offer obtained and does the following:
      1. Gets the ID of the current offer in the loop
      2. If the ID of the current offer is less or equal to the last visited offer ID, the loop is abandoned because we do not want to loop through offers which we already examined
      3. If the current offer is a 'PricePush', it does not contain any errors and the round for that submission is greater than the last observed round, the metrics are updated with the current offer's details by calling <b>updateMetrics</b>
  4. Loops through the balances and the balances for IST and BLD are updated by calling <b>updateBalanceMetrics</b>

  
<div id='chainlinkjs'></div>

### <u>helpers/chainlink.js</u>

<br>
<div id='sendJobRun'></div>

<b>sendJobRun(count, jobId, requestType)</b>

Inputs:
* count - The request id
* jobId - The job id to send the request to
* requestType - The type of request. The request can have the following 3 values:
  - 1 - Time interval expired. This serves a cron and depends on <b>pollInterval</b>(for that feed)
  - 2 - Price deviation trigger. There was a price deviation greater than <b>priceDeviationPerc</b>(for that feed) between the new and previous on-chain prices
  - 3 - A new round was found on-chain

Use: This function is used to send a job request to the job on CL node. If it fails, it retries for a maximum of SUBMIT_RETRIES (defined in environment variables).

What it does:
  1. Reads the credentials from CREDENTIALS_FILE
  2. Creates the request by appending the request id and the request type
  3. It loops for a maximum of SUBMIT_RETRIES and tries to submit the job to the CL node



<div id='dbjs'></div>

### <u>helpers/db.js</u>

This file contains helper functions which are used to update state in the DB.

The file contains the following functions:

<br>
<div id='loadDB'></div>

<b>loadDB()</b>

Use: This function is used to load the DB so that it can be used by the other functions

What it does:
  1. Opens the DB using the sqlite3.Database driver

<br>
<div id='createDBs'></div>

<b>createDBs()</b>

Use: This function is used to initialise the required tables in the DB

What it does:
  1. Loads the DB using loadDB
  2. Creates the required tables if they do not exist using db.exec()

<br>
<div id='getAllJobs'></div>

<b>getAllJobs()</b>

Use: This function is used to get all the jobs in the DB

Returns: An array of jobs

What it does:
  1. Loads the DB using loadDB
  2. Uses db.all() to return all the jobs in the jobs table

<br>
<div id='createJob'></div>

<b>createJob(id, name)</b>

Inputs:
* id - This external job ID of the new CL job
* name - This name of the feed

Use: This function is used to add a new job to the DB and initialise its state.

What it does:
  1. Loads the DB using loadDB
  2. Creates a record in the jobs table using db.exec()
  3. Creates a record in the rounds table using db.exec()

<br>
<div id='deleteJob'></div>

<b>deleteJob(od)</b>

Inputs:
* id - This external job ID of the new CL job

Use: This function is used to delete a job from the DB

What it does:
  1. Loads the DB using loadDB
  2. Removes the job from the jobs and rounds table using db.exec()

<br>
<div id='queryTable'></div>

<b>queryTable(table, fields, name)</b>

Inputs:
* table - The table name to query
* fields - The fields to obtain
* name - The name of the field to query the appropriate feed

Use: This function is used to query either the jobs or rounds table

Returns: An object containing the record in the DB for the given field

What it does:
  1. Loads the DB using loadDB
  2. Builds the SQL query and queries the DB using db.get(). This function is used because we always will need only 1 record. Hence, no need for db.all().

<br>
<div id='updateTable'></div>

<b>updateTable(table, values, name)</b>

Inputs:
* table - The table name to update
* values - A JSON object where the properties would be the column names and the values would be the values to set
* name - The name of the field to update the appropriate feed

Use: This function is used to query either the jobs or rounds table

Returns: An object containing the record in the DB for the given field

What it does:
  1. Loads the DB using loadDB
  2. Builds the SQL command and updates the DB using db.exec().

<br>
<div id='getNextSequence'></div>

<b>getNextSequence()</b>

Use: This function is used to query the next sequence number

Returns: An object containing the next sequence number to be used

What it does:
  1. Loads the DB using loadDB
  2. Builds the SQL query and queries the DB using db.get(). This function is used because we always will need only 1 record. Hence, no need for db.all().#

<br>
<div id='incrementSequence'></div>

<b>incrementSequence()</b>

Use: This function is used to update the next sequence number to be used

What it does:
  1. Loads the DB using loadDB
  2. Builds the SQL command and updates the DB using db.exec().

<div id='helperjs'></div>

### <u>helpers/utils.js</u>

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
<div id='delay'></div>

<b>delay(ms)</b>

Inputs:
* ms - Milliseconds to delay

Use: This function is used to create a delay

Returns: A Promise with a delay of a specified number of milliseconds


<br>
<div id='middlewarehelperjs'></div>

### <u>helpers/middleware-helper.js</u>

<br>
<div id='initialiseState'></div>

<b>initialiseState()</b>

Use: This function is used to initialise the state by creating the necessary tables in the DB

What it does:
  1. Creates the tables in the DB using the function createDBs()


<br>
<div id='submitNewJob'></div>

<b>submitNewJob(feed, requestType)</b>

Inputs:
* feed - The feed to submit a new job request for
* requestType - The request type to send as a parameter with the job request. 1 if a timer request, 2 if triggered by a price deviation, 3 for a new round.

Use: This function is used to send a job request to the CL node

What it does:
  1. Gets the latest request ID from the DB
  2. Increments the request ID
  3. Updates the 'last_request_sent' timestamp to the current timestamp in the DB
  4. Calls <b>sendJobRun</b> to send a job request to the CL node


<br>
<div id='checkIfInSubmission'></div>

<b>checkIfInSubmission(feed)</b>

Inputs:
* feed - The feed to check if a submission was made

Use: This function is used to check if the middleware is still waiting for a price submission confirmation

Returns: A boolean indicating whether last submission was made in less than SEND_CHECK_INTERVAL seconds

What it does:
  1. Gets the time of the last price submission from the DB
  2. Calculates the number of seconds passed from the submission
  3. Returns whether the number of seconds passed exceed SEND_CHECK_INTERVAL

<br>
<div id='checkForPriceUpdate'></div>

<b>checkForPriceUpdate(jobName, requestType, result)</b>

Inputs:
* jobName - The job name or feed for which we want to check
* requestType - The requestType of the price received from the CL node
* result - The price received from the CL node

Use: This function is used to check if a price update should be made on chain after receiving a price from the CL job

Returns: A boolean indicating whether a price update should be made on chain

What it does:
- Checks whether the following criteria is satisfied:
  - SEND_CHECK_INTERVAL seconds passed from the last price push update to ensure that multiple price updates are not pushed simultaneously
  - If it is a new round and the oracle has not started the current on-chain round or if it is not a new round but the oracle has not submitted to the current round on-chain
  - One of the following:
    - If its time for a price update by comparing the timestamp of the last round and now by making use of <b>pushInterval</b>(for that feed) (Request type 1)
    - If there is a price deviation greater than <b>priceDeviationPerc</b>(for that feed) between the received price and the latest price on chain (Request type 2)
    - If there was a new a new round (Request type 3)

<br>
<div id='credentials'></div>

### <u>helpers/credentials.js</u>

This contains a class to hold the External Initiator credentials

<br>
<div id='credentialsproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.credentials - This is an object which holds the credentials. This object has the following structure
```json
{
  "EI_IC_ACCESSKEY": "",
  "EI_IC_SECRET": ""
}
```

<br>
<div id='constructorCredentials'></div>

<b>constructor(filePath)</b>

Inputs:
* filePath - The file path from where to read credentials

Use: This function is used to construct an object of the class by loading the credentials from file and validating them

What it does:
- Reads the credentials from file by using readJSONFile()
- Validates the credentials by calling validate()

<br>
<div id='validateCredentials'></div>

<b>validate()</b>

Use: This function validates the credentials object after reading the file containing the credentials. It throws an error if there is a missing property.

What it does:
- Throws an error if EI_IC_ACCESSKEY is not present
- Throws an error if EI_IC_SECRET is not present

<div id='feedsconfigjs'></div>

### <u>helpers/feeds-config.js</u>

<br>
<div id='feedsconfigproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.feeds - This is an object which holds the feeds read from the feeds config file at config/feeds-config.json. This object has the following structure
```json
{
  "ATOM-USD" : {
    "decimalPlaces": 6,
    "pollInterval": 180,
    "pushInterval": 600,
    "priceDeviationPerc": 1 
  },
  "OSMO-USD" : {
    "decimalPlaces": 6,
    "pollInterval": 180,
    "pushInterval": 600,
    "priceDeviationPerc": 1 
  }
}
```

<br>
<div id='constructorFeedsconfig'></div>

<b>constructor()</b>

Use: This function is used to construct an object of the class by loading the feeds' configuration from file and performing validation

What it does:
- Reads the credentials from file by using readJSONFile()
- Validates the credentials by calling validate()

<br>
<div id='validateFeedsconfig'></div>

<b>validate()</b>

Use: This function validates the feeds config object after reading the file containing the configuration of feeds. It throws an error if there is a missing property.

What it does:
- Loops through each feed (key) in the loaded object and does the following:
    - Throws an error if decimalPlaces is not present    
    - Throws an error if pollInterval is not present    
    - Throws an error if pushInterval is not present    
    - Throws an error if priceDeviationPerc is not present    


<div id='middlewareenvjs'></div>

### <u>helpers/middleware-env.js</u>

<br>
<div id='middlewareenvproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.MIDDLEWARE_PORT - The port on which the middleware will listen for job updates or results from the CL node
* this.AGORIC_RPC - The Agoric node's RPC
* this.ACCOUNT_NUMBER - The account number from which to sign transactions
* this.FROM - The address of the oracle from which to push prices
* this.SUBMIT_RETRIES -  The number of retries to try when submitting a price on-chain and it fails
* this.SEND_CHECK_INTERVAL - The interval in seconds which is waited between each send. 
* this.BLOCK_INTERVAL - The block time of the chain in seconds. This is used to query the price and round at every interval.
* this.EI_CHAINLINKURL - The CL node URL in order to connect to its API to listen for jobs and send job requests.
* this.CREDENTIALS_FILE - The path to the file containing the credentials to the CL external initiator
* this.DB_FILE - This holds the path of the database state file

<br>
<div id='constructorMiddlewareenv'></div>

<b>constructor()</b>

Use: This function is used to fill load the environment variables inside the properties explained above and to perform validation on them

What it does:
- Reads the environment variables using process.env
- Validates the credentials by calling validate()

<br>
<div id='validateMiddlewareenv'></div>

<b>validate()</b>

Use: This function validates all the properties explained above

What it does:
- Throws an error if this.MIDDLEWARE_PORT is not a number    
- Throws an error if this.SUBMIT_RETRIES is not a number    
- Throws an error if this.ACCOUNT_NUMBER is not a number    
- Throws an error if this.SEND_CHECK_INTERVAL is not a number    
- Throws an error if this.EI_CHAINLINKURL is not a valid URL
- Throws an error if this.CREDENTIALS_FILE does not exist
- Throws an error if this.DB_FILE is empty

<b>
<div id='monitorenvjs'></div>

### <u>helpers/monitor-env.js</u>

<br>
<div id='monitorenvproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.MONITOR_PORT - The port on which the monitor will serve metrics
* this.MONITOR_POLL_INTERVAL - The interval in seconds which needs to pass between each price and round check
* this.AGORIC_NET - Agoric's chain
* this.AGORIC_RPC - The Agoric node's RPC
* this.MONITOR_STATE_FILE -  The path to the monitoring state's file
* this.ORACLE_FILE - The path to the file containing the oracles to monitor 

<br>
<div id='constructorMiddlewareenv'></div>

<b>constructor()</b>

Use: This function is used to fill load the environment variables inside the properties explained above and to perform validation on them

What it does:
- Reads the environment variables using process.env
- Validates the credentials by calling validate()

<br>
<div id='validateMiddlewareenv'></div>

<b>validate()</b>

Use: This function validates all the properties explained above

What it does:
- Throws an error if this.PORT is not a number    
- Throws an error if this.SUBMIT_RETRIES is not a number    
- Throws an error if this.SEND_CHECK_INTERVAL is not a number    
- Throws an error if this.EI_CHAINLINKURL is not a valid URL
- Throws an error if this.CREDENTIALS_FILE does not exist
- Throws an error if this.DB_FILE does not exist

<b>
<div id='monitormetricsjs'></div>

### <u>helpers/monitor-metrics.js</u>

<br>
<div id='metrics'></div>

<b>Metrics</b>

The following is a list of metrics exposed by the monitoring script:

- <u>oracle_latest_value</u> - This metric contains the latest submitted value by an oracle. The labels include oracleName, oracle and feed which represent the oracle name, oracle address and the feed respectively.
- <u>oracle_last_observation</u> -  This metric contains the timestamp of the latest submission by an oracle. The labels include oracleName, oracle and feed which represent the oracle name, oracle address and the feed respectively.
- <u>oracle_last_round</u> - This metric contains the round of the latest submission by an oracle. The labels include oracleName, oracle and feed which represent the oracle name, oracle address and the feed respectively.
- <u>oracle_price_deviation</u> - This metric contains the deviation between an oracle's submitted value and the aggregated on-chain value. The labels include oracleName, oracle and feed which represent the oracle name, oracle address and the feed respectively.
- <u>oracle_balance</u> - This metric contains the balance of an oracle for a brand. The labels include oracleName, oracle and brand which represent the oracle name, oracle address and the brand respectively.
- <u>actual_price</u> - This metric contains the actual aggregated value on chain. The labels include feed which represents the feed for the price.
- <u>config_threshold</u> - This metric contains the config deviation threshold for every feed
- <u>config_heartbeat</u> - This metric contains the config heartbeat for every feed
- <u>consensus_time_taken</u> - This metric contains the time taken for consensus for the last round which achieved consensus
- <u>oracle_rounds_created</u> - This metric contains the number of rounds created by the oracle

<br>
<div id='constructorMonitormetrics'></div>

<b>constructor()</b>

Use: This function is used to initialise the Registry, Gauge metrics and to register the metrics to the registry

What it does:
- Creates a new Registry
- Initialises the metrics
- Registers the metrics to the registry

<br>
<div id='updateMetrics'></div>

<b>updateMetrics(oracleName, oracle, feed, value, id, actualPrice, lastRound, createdRounds)</b>

Inputs:
* oracleName - The name of the oracle
* oracle - The address of the oracle
* feed - The feed
* value - The latest submitted value on chain
* id - The submission ID which is also the last timestamp
* actualPrice - The actual aggregated price on chain
* lastRound - The latest round ID for which a submission was made
* createdRounds - The number of created rounds by the oracle

Use: This function is used to update metrics 

What it does:
  1. Calculates the deviation between the price submitted and the aggregated price on chain
  2. Updates the metrics


<br>
<div id='updateBalanceMetrics'></div>

<b>updateBalanceMetrics(oracleName, oracle, brand, value)</b>

Inputs:
* oracleName - The name of the oracle
* oracle - The address of the oracle
* brand - The brand
* value - The latest balance value

Use: This function is used to update balance metrics 

What it does:
  1. Updates the metrics

<br>
<div id='setConfigMetrics'></div>

<b>setConfigMetrics(feed, threshold, heartbeat)</b>

Inputs:
* feed - The feed name
* threshold - The value to set for threshold
* heartbeat - The value to set for heartbeat

Use: This function is used to set the config metrics

What it does:
  1. Updates the metrics

<br>
<div id='updateConsensusTimeTaken'></div>

<b>updateConsensusTimeTaken(feed, consensusTime)</b>

Inputs:
* feed - The feed name
* consensusTime - The consensus time take to set

Use: This function is used to update balance metrics 

What it does:
  1. Updates the metrics

<b>
<div id='monitoringstatejs'></div>

### <u>helpers/monitoring-state.js</u>

<br>
<div id='monitoringstateproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.stateFile - The path to the state file
* this.state - This contains the monitoring state of each oracle being monitored. The object has the following structure:
```json
{
  "agoric123456": {
    "last_index": 0,
    "values": {
      "ATOM-USD": {
        "price": 12.915342,
        "id": 1677683115273,
        "round": 2463
      }
    }
  }
}
```

<br>
<div id='constructorMonitoringstate'></div>

<b>constructor()</b>

Use: This function is used to create an object which holds the monitoring state. This reads the state from file and validates it

What it does:
- Sets the file path of the state file to this.stateFile
- Reads the monitoring state by calling readMonitoringState()
- Validates the read state by calling validate()

<br>
<div id='validateMonitoringstate'></div>

<b>validate()</b>

Use: This function is used to validate the monitoring state

What it does:
- Loops through each oracle in the monitoring state and does the following
    - Throws an error if the object has no last_index property
    - Throws an error if the object has no values property
    - If the last_index is not 0, it does the following:
        - Throws an error if values does not contain price
        - Throws an error if values does not contain id
        - Throws an error if values does not contain round

<br>
<div id='readMonitoringState'></div>

<b>readMonitoringState(oracleConfig)</b>

Inputs:
* oracleConfig - The oracle config containing the addresses and names of oracles to monitor

Use: This function is used to read the monitoring state from the MONITOR_STATE_FILE. This is used upon startup to continue on previous data.

What it does:
  1. Tries to read the file using <b>readJSONFile</b>
  2. If it succeeds, it returns the state
  3. If it fails, it initialises the state and saves it to file
  4. Sets the initialised or read state to this.state

<br>
<div id='initialiseStateForOracle'></div>

<b>initialiseStateForOracle(oracle)</b>

Inputs:
* oracle - The address of the oracle whose state is to be initialised

Use: This function is used to initialise the state of a particular oracle

What it does:
  1. Creates an empty entry in this.state for the oracle with last_index set to 0 and an empty values object
  2. Saves the state to file by calling saveJSONDataToFile()

<br>
<div id='updateOracleState'></div>

<b>updateOracleState(oracle, newState)</b>

Inputs:
* oracle - The address of the oracle whose state is to be updated
* newState - The new state to set to the oracle

Use: This function is used to to update the state for an oracle

What it does:
  1. Sets the state of the oracle in this.state to newState
  2. Saves the state to file by calling saveJSONDataToFile()

<b>
<div id='oraclemonitorconfigjs'></div>

### <u>helpers/oracle-monitor-config.js</u>

<br>
<div id='omcproperties'></div>

<b>Properties</b>

This class contains the following properties

* this.oracles - The holds the config found in ORACLE_FILE. This object has the following structure:
```json
{
  "agoric123" : { 
    "oracleName": "Oracle 1" 
  },
  "agoric345" : { 
    "oracleName": "Oracle 2" 
  },
  "agoric789" : { 
    "oracleName": "Oracle 3" 
  }
}
```
* this.amountsIn - This holds an object of amountsIn for feeds. This structure of this object looks similar to the following structure
```json
{
  "ATOM-USD": 100000,
  "OSMO-USD": 100000,
}
```

<br>
<div id='constructorOraclemonitorconfig'></div>

<b>constructor(filePath)</b>

Inputs:
* filePath - The file path to the config containing the oracles to monitor. This is equal to the ORACLE_FILE environment variable.

Use: This function is used initialise an object which contains the details of the oracles to monitor and an object containing the amountsIn for feeds in order to calculate the price.

What it does:
- Reads the oracles config by calling readJSONFile() and sets the output to this.oracles
- Initialises this.amountsIn to an empty object
- Validates the read config by calling validate()
- Fills this.amountsIn by calling getInvsForOracles()

<br>
<div id='validateOraclemonitorconfig'></div>

<b>validate()</b>

Use: This function is used to validate the oracles config

What it does:
- Loops through each oracle loaded in this.oracles
    - Throws an error if the object has no oracleName property

<br>
<div id='getInvsForOracles'></div>

<b>getInvsForOracles()</b>

Use: This function is used to obtain the invitation IDs for feed participation for the oracles and to fill this.amountsIn

What it does:
- Loops through each oracle loaded in this.oracles and does the following:
    - Gets the oracle's invitations by calling getOraclesInvitations()
    - Loops through the different feeds in the obtained list of invitations and does the following:
      - Sets the invitation IDs of the feed to the oracle's config entry
      - Sets the amountIn for that feed if it is not already in the this.amountsIn

<br>
<div id='rounddetailsjs'></div>

### <u>helpers/round-details.js</u>

<br>
<div id='rounddetailsproporties'></div>

<b>Properties</b>

This class contains the following properties

* this.roundId - The holds the round ID for the round
* this.startedAt - This holds the timestamp when this round was started
* this.startedBy - This holds the address of the oracle who started the round
* this.submissionMade - This holds whether the oracle submitted to this round

<br>
<div id='constructorRoundDetails'></div>

<b>constructor(roundId, startedAt, startedBy, submissionMade)</b>

Inputs:
* roundId - The holds the round ID for the round
* startedAt - This holds the timestamp when this round was started
* startedBy - This holds the address of the oracle who started the round
* submissionMade - This holds whether the oracle submitted to this round

Use: This function is used initialise an object by just setting the passed variables to the object's properties

What it does:
- Sets the passed in values to the object's properties

<br>
<div id='toObject'></div>

<b>toObject()</b>

Use: This function is used to turn this class' properties into a single object

What it does:
- Places the object's properties in a single object of the following structure
```
{
  roundId: 1,
  startedAt: 1677686233,
  startedBy: "agoric123",
  submissionMade: true
}
```

<br>
<div id='bridgejs'></div>

### <u>oracle/bridge.js</u>


<br>
<div id='startBridge'></div>

<b>startBridge(port)</b>

Inputs:
* port - The port to listen on

User: This function is used to start a server which listens to requests for a job addition, a job removal and a new job result. This server should serve the following endpoints:
1. <b>POST /adapter</b> - to get a job result from a CL node
2. <b>POST /jobs</b> - to get a new job addition from a CL node
3. <b>DELETE /jobs/:id</b> - to get a job removal from a CL node

What it does:

<div id='postadapter'></div>

a. <u>/adapter</u>: This is the endpoint which is used to accept job results from CL job requests. This endpoint does the following:
  - Read the result, request ID, request type and job name from the received body
  - Check if an actual result was received and if not return a status 500 response. If a result is received, a 200 is sent as response.
  - Obtain the last price on-chain from the DB
  - Obtain the round to push the price for by checking whether the latest round on-chain is greater than the oracle's last reported round. If so, the round ID would be the latest round on chain. Otherwise, the latest round on chain is incremented by 1 as a new round would need to be created.
  - Checks whether a price update should be submitted on chain by calling checkForPriceUpdate()
  - Update the 'last_reported_round' and the request ID of latest job result received from CL node in the DB
<div id='postjobs'></div>

b. <u>/jobs</u>: This is the endpoint which is used to handle a new job created on the CL node. This endpoint adds the job to the jobs table in the DB.

<div id='deljobs'></div>

c. <u>/jobs/:id</u>:  This is the endpoint which is used to handle a job removal on the CL node. This endpoint removes the job from the DB.

<br>
<div id='controllerjs'></div>

### <u>oracle/controller.js</u>

<br>
<div id='makeController'></div>

<b>makeController()</b>

Use: This function serves as the controller for the middleware and it basically consists of two intervals running separately. One is triggerred every second and it is used to create a CL node job once this timer triggers. The other is triggered every BLOCK_INTERVAL and it is used to query the latest price and round stored on-chain. The latter will check if there is a price deviation or a new round and if so, a new CL job request is sent to the CL node

What it does:
  1. Creates an interval using setInterval to trigger every second. This will go through every job in the state and creates a CL job for each job depending whether the <b>pollInterval</b> for that feed expired.
  2. Creates a second interval using setInterval to trigger every BLOCK_INTERVAL. This will do the following:
      1. Reads the jobs from the DB
      2. Loops through all the jobs
      3. For every job it does the following:
          - Queries the price on-chain
          - Queries the round on-chain
          - Update the latest price and round in the DB for that job
          - If there is a new round and a submission is already made for that round, the 'last_reported_round' is updated in the DB. Otherwise, if a submission is not made, a new CL job request of type 3 is prepared
          - It will check for a price deviation from the previous on-chain price and if there is a price deviation greater than <b>priceDeviationPerc</b>(for that feed), a new CL job request of type 2 is prepared
          - If one of the above conditions is met and a CL job request is prepared, a final check is made. <b>This is done to avoid creating duplicate CL job requests resulting in extra subscription costs for oracles</b>. The CL job request is ONLY sent if one of the following conditions is met:
            1. There is no pending CL job request for which we are still waiting for. This is done by comparing the request ID of the last request sent and received from the DB.
            2. An interval of SEND_CHECK_INTERVAL passed from the last CL job request which was sent.


<br>
<div id='middlewarejs'></div>

### <u>oracle/middleware.js</u>

This file contains all the functions which are used by the middleware. 

<br>
<div id='envvarsmiddleware'></div>

<b>Environment Variables</b>

This script makes use of the following environment variables.

| Variable Name        	| Description                                                                                                                                                          	| Default value              	|
|----------------------	|----------------------------------------------------------------------------------------------------------------------------------------------------------------------	|----------------------------	|
| MIDDLEWARE_PORT                 	| The port on which the middleware will listen <br>for job updates or results from the CL node                                                                         	| 3000                       	|
| EI_CHAINLINKURL      	| The CL node URL in order to connect to its API<br>to listen for jobs and send job requests.<br><b>Note that this has no default value and needs<br>to be defined</b> 	| N/A                        	|
| FROM                 	| The address of the oracle from which to push prices.<br><b>Note that this has no default value and needs<br>to be defined</b>                                        	| N/A                        	|
| SUBMIT_RETRIES       	| The number of retries to try when submitting a price<br>on-chain and it fails                                                                                        	| 3                          	|
| ACCOUNT_NUMBER       	| The account number                                                                                        	| N/A                          	|
| BLOCK_INTERVAL       	| The block time of the chain in seconds. This is used<br>to query the price and round at every interval.                                                              	| 6                          	|
| SEND_CHECK_INTERVAL  	| The interval in seconds which is waited between each send.                                                                                                           	| 45                         	|
| AGORIC_RPC           	| The Agoric node's RPC endpoint                                                                                                                                       	| http://0.0.0.0:26657       	|
| CREDENTIALS_FILE     	| The path to the file containing the credentials to the <br>CL node                                                                                                   	| config/ei_credentials.json 	|
| DB_FILE     	| The path to the database state file                                                                                                   	| data/database.db 	|


The CREDENTIALS_FILE should contain a JSON object containing the credentials to communicate with the CL node as can be seen below
```json
{
  "EI_IC_ACCESSKEY": "",
  "EI_IC_SECRET": ""
}
```

<br>
<div id='middlewarefunc'></div>

<b>middleware()</b>

Use: This function is used as entry to the middleware functions

What it does:
  1. Initialises state
  2. Starts the bridge to listen for new jobs and job results
  3. Starts the controller on the first second of the next minute. This is done to try and have all middleware pushing jobs on approximetely the first second of each new minute

<br>
<div id='monitorjs'></div>

### <u>oracle/monitor.js</u>

This file contains all the functions which are used by the monitoring script. 

<br>
<div id='envvarsmonitor'></div>

<b>Environment Variables</b>

This script makes use of the following environment variables and it requires them in order to function. In fact, it contains validation upon entry to make sure they are well defined.

| Variable Name 	| Description                                                                       	| Default value              	|
|---------------	|-----------------------------------------------------------------------------------	|----------------------------	|
| MONITOR_PORT          	| The port on which the monitor will serve metrics                                  	| 3001                       	|
| MONITOR_POLL_INTERVAL 	| The interval in seconds which needs to pass between<br>each price and round check 	| 10                         	|
| AGORIC_NET    	| Agoric's chain ID                                                                 	| N/A                        	|
| AGORIC_RPC    	| The Agoric's node RPC endpoint                                                    	| http://0.0.0.0:26657       	|
| MONITOR_STATE_FILE    	| The path to the monitoring state's file                                           	| data/monitoring_state.json 	|
| ORACLE_FILE   	| The path to the file containing the oracles to monitor                            	| config/oracles.json        	|


The ORACLE_FILE should contain a JSON array containing the oracles to monitor along with their addresses as can be seen below
```json
{
  "agoric1abcdef12.." : { "oracleName": "ORACLE 1" },
  "agoric1abcdef34.." : { "oracleName": "ORACLE 2" },
  "agoric1abcdef56.." : { "oracleName": "ORACLE 3" },
  "agoric1abcdef78.." : { "oracleName": "ORACLE 4" }
}
```


<br>
<div id='monitorfunc'></div>

<b>monitor()</b>

Use: This function is used as the entry point to the monitoring script. It contains an interval based on MONITOR_POLL_INTERVAL to obtain details about each oracle being monitored and update the metrics

What it does:
  1. It loops through the list of oracles to monitor and gets the latest submission details by calling <b>getLatestPrices()</b>. It does this every X seconds based on MONITOR_POLL_INTERVAL
  2. It saves the state with the latest values for the oracles being monitored

<br>
<div id='startServer'></div>

<b>startServer()</b>

Use: This function is used to create a server to host a metrics page at <b>/metrics</b>

What it does:
  1. Start a server which listens on PORT and makes metrics available at the endpoint /metrics


