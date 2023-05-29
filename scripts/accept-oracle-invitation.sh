#!/bin/bash

WALLET_NAME=$1
BRAND_IN=$2
BRAND_OUT=$3
CHAIN_ID=$4
AGORIC_RPC=$5

AGORIC_SDK=$(find ~ -type d -name "agoric-sdk" | head -n 1)

WALLET_ADDR=$(agd keys show "$WALLET_NAME" --keyring-backend test --output json | jq -r .address)
ORACLE_OFFER=$(mktemp -t agops.XXX)
./src/bin-agops.js oracle accept --pair "$BRAND_IN.$BRAND_OUT" >|"$ORACLE_OFFER"
cat $ORACLE_OFFER
OFFER_TO_SEND=$(cat $ORACLE_OFFER | jq .)
agd --chain-id=$CHAIN_ID --keyring-backend=test --from=$WALLET_ADDR tx swingset wallet-action --allow-spend "$OFFER_TO_SEND" --yes --node $AGORIC_RPC
sleep 3

echo "Accepted oracle invitation from $WALLET_ADDR"