# Agoric Oracle Middleware

- [Oracle Network Structure](#oracle-network-structure)
- [Smart Contract Details](#smart-contract-details)
- [Aims/Objectives](#aims/objectives)
  - [Middleware](#middleware)
  - [Monitoring](#monitoring)
- [File structure](#file-structure)
- [Technical Documentation](#technical-documentation)
- [How to run](#htr)

## Oracle Network Structure

<img src="docs/images/struct.png"></img>
<br>

Each node operator has to run:
- A Chainlink node hosted locally in Docker that queries <a href="https://docs.chain.link/chainlink-nodes/external-adapters/external-adapters/">Chainlink adapters</a>
- Chainlink adapters hosted beside the Chainlink node that act as middleware between the node as various 3rd party APIs
- Middleware which initiates jobs on the Chainlink node through its API if a round hasn't been created in 1 minute on the on chain aggregator contract. Rounds are also created if the oracle operator's current price is deviated past X% from the latest on-chain median price. Oracle operators are not allowed to create 2 rounds subsequently to prevent spamming.
- An Agoric node hosted on their own infrastructure to allow the middleware / oracle proxy to communicate and broadcast transactions reliably to the network.

Before making use of this middleware, oracles should prepare their setups using this <a href="https://github.com/jacquesvcritien/agoric-chainlink-setup-docs">setup guide</a>.

## Smart Contract Details

Smart Contract - https://github.com/Agoric/agoric-sdk/tree/8720d22ddf25a005aee25786bfa8ee4bccaf19c9/packages/inter-protocol/src/price

- The smart contract resembles a native Chainlink Solidity Flux-Monitor smart contract on Ethereum (Example - https://etherscan.io/address/0x79febf6b9f76853edbcbc913e6aae8232cfb9de9).
- For each feed, there will be a smart contract on chain and each node operator receives invitations to their smart wallet to be part of the oracle set. Then, oracles can use that invitation to push prices on chain.
- There is a minimum number of submissions which has to be reached in order for the on-chain price to be updated
- An oracle cannot initialise multiple consecutive rounds to avoid network congestion
- The updated price is the median from the submitted prices for a particular round
- Submissions for old rounds cannot be submitted and will be rejected

## Aims/Objectives

#### Middleware

The middleware is needed to:
1. Create CL jobs. CL jobs are created every minute. A cron job is not used in order to be able to pass in particular inputs to the job run so that the progress of the request can be stored and monitored.
2. Get price responses back from the CL node after Job requests are made from the middleware.
3. Query smart contract to see if submission period for a new round is open.
4. Submit a transaction to update prices on-chain.

The middleware should contain the following functionalities:

1. An SQLite database that allows the middleware to resume from its last execution whenever it is restarted.
2. An endpoint that listens for new and removed jobs from the CL node, allowing the middleware to maintain a list of jobs for which requests need to be sent.
3. Keep a list of active jobs in its state
4. Query the price on chain and the latest round every X seconds so that a new job request is created if a new round is found
5. Send CL job requests to the CL node with parameters including a request ID and the reason for the request every Y seconds. The reason can be one of the following 3 reasons:
    1. Type 1: Time expired and a new request have to be made
    2. Type 2: A price deviation from the on-chain price was found
    3. Type 3: A new round was found
6. An endpoint to listen for results from a CL job for submitted job requests. This endpoint should decide whether or not to push the price on chain. A price should be pushed on chain if one of the following cases is satisfied:
    1.  It is a new round and the oracle has not yet submitted to this round
    2. An interval of Z minutes/hours expired since the last price pushed on chain. **NOTE**: This is only done if the oracle has not started the previous round, as oracles are not allowed to start consecutive rounds.
    3. There is a deviation of more than W% from the current price on-chain. Once again, only done if the oracle has not started the previous round.
7. Keep the following information in the DB for each job in the jobs table

| Table Name 	| Field Name               	| Description                                                 	| Type   	|
|------------	|--------------------------	|-------------------------------------------------------------	|--------	|
| jobs       	| id                       	| The CL job's external id for that feed                      	| String 	|
| jobs       	| name                     	| The name of the feed                                        	| String 	|
| jobs       	| request_id               	| The last request id                                         	| Number 	|
| jobs       	| last_reported_round      	| The last reported round on chain                            	| Number 	|
| jobs       	| last_request_sent        	| The timestamp of the last price submission made on chain    	| Number 	|
| jobs       	| last_submission_time     	| The timestamp of the last request made to the CL node       	| Number 	|
| jobs       	| last_result              	| The last aggregated price on chain                          	| Number 	|
| jobs       	| last_received_request_id 	| The request id of the last result received from the CL node 	| Number 	|

8. Keep the following information in the DB for each job in the jobs table:

| Table Name 	| Field Name      	| Description                                        	| Type    	|
|------------	|-----------------	|----------------------------------------------------	|---------	|
| rounds     	| feed            	| The name of the feed                               	| String  	|
| rounds     	| roundId        	| Latest round id                                    	| Number  	|
| rounds     	| startedAt      	| The timestamp when the round was started           	| Number  	|
| rounds 	    | startedBy      	| The address who started the latest round           	| String  	|
| rounds 	    | submissionMade 	| Whether a submission was made for the latest round 	| Boolean 	|

#### Monitoring

The monitoring script is needed to:
1. Monitor the actual price and that it is being updated
2. Monitor node operators' submissions to ensure they are submitting values within acceptable thresholds and that they are submitting to rounds and not missing them
3. Monitor node operators' balances to ensure they have enough balance for transaction fees to push prices on chain
4. Monitor the rate at which rounds are being created

The monitoring script should contain the following functionalities:

1. A state file which is updated so that whenever the monitoring script is restarted it is able to continue from where it was stopped.
2. Monitor multiple oracles at once
3. An endpoint to expose prometheus metrics which are a set of time-series data which can be graphed and used to monitor the whole oracle network.
4. Expose the following metrics
    1. The latest submitted value on chain by an oracle for a feed
    2. The timestamp in which an oracle made an on-chain submission for a feed 
    3. The last round for which an oracle made an on-chain submission for a feed
    4. The deviation of an oracle's submitted price from the latest aggregated value on-chain for a feed
    5. The oracle balance 
    6. The actual price on-chain
4. See all invitations IDs to be part of the oracle set from wallets
5. Query the latest prices and round submissions of oracles every X seconds and update the metrics
6. Have an efficient way of polling only the latest price pushes so be able to monitor oracles efficiently when the number of offers used start to increase


## File structure

In this section, one is able to find a description of the file structure and the contents of files

#### migrations

The migrations directory contains SQL files used to migrate the DB and update it smoothly without any user intervention.

#### scripts

The scripts directory contains scripts which are used to for deployments. 

The following are the different scripts which can be found in this directory

1. accept-oracle-invitation.sh - This script can be used to accept an oracle invitation. This script takes in 3 parameters, the wallet name, the brand in and brand out. An example of a command to run this is ```./accept-oracle-invitation.sh $WALLET_NAME ATOM USD```. This requires the oracles to have provisioned a smart wallet as per the <a href="https://github.com/jacquesvcritien/agoric-chainlink-setup-docs">setup docs</a>.
2. provision-wallet.sh - This script can be used to provision a smart wallet. This script takes in one parameter, the wallet name. An example of a command to run this is ```./provision-wallet.sh $WALLET_NAME```. This requires oracles to have created a wallet as per the <a href="https://github.com/jacquesvcritien/agoric-chainlink-setup-docs">setup docs</a>.

#### config

This directory contains the following file:

1. <b>feeds-config.json</b> - This file contains the configuration for each feed in the oracle network. Each feed will have the following fields:
  - <u>pollInterval</u> - The interval in seconds which needs to pass between each CL job
  - <u>pushInterval</u> - The interval in seconds which needs to pass between each round creation on-chain
  - <u>decimalPlaces</u> - The number of decimal places allowed for the price
  - <u>priceDeviationPerc</u> - The price deviation percentage threshold on when to create a new round on-chain 
The file should have the following structure
```json
{
    "ATOM-USD" : {
        "decimalPlaces": 6,
        "pollInterval": 60,
        "pushInterval": 600,
        "priceDeviationPerc": 1 
    },
    "OSMO-USD" : {
        "decimalPlaces": 6,
        "pollInterval": 60,
        "pushInterval": 600,
        "priceDeviationPerc": 1 
    }
}
```

#### src

This directory includes all the source code. It is split into three other directories, <b>helpers</b>, <b>oracle</b> and <b>lib</b>.

Furthermore, it contains the following two files which serve as an entry point to the middleware and monitoring script:

* <b>bin-middleware.js</b> - This serves as an entry point to the middleware by calling the middleware() function
* <b>bin-monitor.js</b> - This serves as an entry point to the monitoring script by calling the getOraclesInvitations() and monitor() functions to first get the oracle invitation IDs and then starting the monitoring. 

##### helpers

This directory contains the following files:

1. <b>chain.js</b> - This file contains helper functions which are needed to interact with the Agoric chain
2. <b>chainlink.js</b> - This file contains helper functions to send job requests to the CL node
3. <b>db.js</b> - This file contains helper functions related to the database
4. <b>utils.js</b> - This file contains basic helper functions 
5. <b>MiddlewareEnv.js</b> - This file contains a class to represent the middleware's environment variables
6. <b>MonitorEnv.js</b> - This file contains a class to represent the monitoring script's environment variables
7. <b>logger.js</b> - This file exports a logger
8. <b>MonitoringState.js</b> - This file contains a class to represent the monitoring script's state and to interact with it
9. <b>MonitorMetrics.js</b> - This file contains a class to represent the monitoring script's metrics
10. <b>OracleMonitorConfig.js</b> - This file contains a class to represent the monitoring script's config 
11. <b>Credentials.js</b> - This file contains a class to represent the EI credentials
12. <b>FeedsConfig.js</b> - This file contains a class to represent the feeds configuration
12. <b>RoundDetails.js</b> - This file contains a class to represent round details


##### oracle

This directory contains the following files

1. <b>bridge.js</b> - This file contains the NodeJS server which will listen to requests from the CL node
2. <b>controller.js</b> - This file contains the controller which will query the chain for rounds and prices
3. <b>middleware.js</b> - This file contains all the necessary code and functions for the middleware
4. <b>monitor.js</b> - This file contains all the necessary code and functions for monitoring the oracle network

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

Technical documentation can be found [here](docs/otherfile.md)

## How to run 
#### Create oracles.json file

In order to monitor oracles, you need to create a file at <b>~/config/oracles.json</b>. 
As can be seen below, it takes an array of oracles with their addresses and names.

```json
{
  "agoric12345aaaaaaaaaa" : { "oracleName": "Oracle 1" },
  "agoric678910bbbbbbbbb" : { "oracleName": "Oracle 2" }
}
```

#### To run both the middleware and monitoring script

```bash
docker-compose build
docker-compose up -d
```
