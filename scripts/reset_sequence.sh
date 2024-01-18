#!/bin/bash

WALLET_NAME=$1
AGORIC_REST=$2

AGORIC_SDK=$(find ~ -type d -name "agoric-sdk" | head -n 1)
WALLET_ADDR=$(agd keys show "$WALLET_NAME" --keyring-backend test --output json | jq -r .address)

SEQUENCE_NUMBER=$(curl "$AGORIC_REST/cosmos/auth/v1beta1/accounts/$WALLET_ADDR" -s | jq -r '.account.sequence')
echo "NEXT SEQUENCE NUMBER: $SEQUENCE_NUMBER"

DB_FILE=~/state/database.db
row_exists=$(sqlite3 "$DB_FILE" "SELECT 1 FROM sequence_numbers WHERE rowid = 1;")

if [ "$row_exists" = "1" ]; then
  # Row exists, update next_num
  sqlite3 "$DB_FILE" "UPDATE sequence_numbers SET next_num = $SEQUENCE_NUMBER WHERE rowid = 1;"
else
  # Row doesn't exist, create a new row
  sqlite3 "$DB_FILE" "INSERT INTO sequence_numbers (rowid, next_num) VALUES (1, $SEQUENCE_NUMBER);"
fi
