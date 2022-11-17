#!/bin/bash

WALLET_NAME=$1
BRAND_IN=$2
BRAND_OUT=$3

WALLET_ADDR=$(agd keys show "$WALLET_NAME" --keyring-backend test --output json | jq -r .address)
cd ../../agoric-cli
ORACLE_OFFER=$(mktemp -t agops.XXX)
bin/agops oracle accept --pair "$BRAND_IN.$BRAND_OUT" >|"$ORACLE_OFFER"
cat $ORACLE_OFFER
jq ".body | fromjson" <"$ORACLE_OFFER"
bin/agoric wallet send --from "$WALLET_ADDR" --keyring-backend test --offer "$ORACLE_OFFER"
bin/agoric wallet show --from "$WALLET_ADDR"
ORACLE_OFFER_ID=$(jq ".body | fromjson | .offer.id" <"$ORACLE_OFFER")
echo "ORACLE_OFFER_ID: $ORACLE_OFFER_ID"
cd ../agoric-cl-middleware/scripts

CONFIG_DIR=~/config
OFFERS_FILE=$CONFIG_DIR/offers.json

if [ ! -d $CONFIG_DIR ]; then
	mkdir -p $CONFIG_DIR
fi

if [ ! -f "$STATE_FILE" ]; then
	echo "{}" > $OFFERS_FILE
fi
echo $(jq ". += {\"$BRAND_IN-$BRAND_OUT\": $ORACLE_OFFER_ID}" $OFFERS_FILE) > $OFFERS_FILE
