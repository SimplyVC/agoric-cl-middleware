#!/bin/bash

WALLET_NAME=$1
AGORIC_REST=$2

AGORIC_SDK=$(find ~ -type d -name "agoric-sdk" | head -n 1)
WALLET_ADDR=$(agd keys show "$WALLET_NAME" --keyring-backend test --output json | jq -r .address)

SEQUENCE_NUMBER=$(curl "$AGORIC_REST/cosmos/auth/v1beta1/accounts/$WALLET_ADDR" -s | jq -r '.account.sequence')
SEQUENCE_NUMBER=$((SEQUENCE_NUMBER + 1))

sqlite3 ~/state/database.db "UPDATE sequence_numbers SET next_num = $SEQUENCE_NUMBER;"
