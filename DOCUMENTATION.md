# Documentation

- [Aims/Objectives](#aims/objectives)
  - [Middleware](#middleware)
  - [Monitoring](#monitoring)
- [File structure](#file-structure)


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

## Function documentation

