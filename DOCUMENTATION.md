# Documentation

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

##### oracle

This directory contains the following files

1. helper.js - This file contains helper functions used in middleware.js and monitor.js
2. middleware.js - This file contains all the necessary code and functions for the middleware
3. monitor.js - This file contains all the necessary code and functions for monitoring the oracle network
