#!/bin/bash

WALLET_NAME=$1

AGORIC_SDK=$(find ~ -type d -name "agoric-sdk" | head -n 1)

WALLET_ADDR=$(agd keys show "$WALLET_NAME" --keyring-backend test --output json | jq -r .address)

cd $AGORIC_SDK/packages/agoric-cli

bin/agoric wallet provision --spend --account "$WALLET_ADDR" --keyring-backend test