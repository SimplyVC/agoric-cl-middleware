# Agoric Oracle Middleware

## Create oracles.json file

In order to monitor oracles, you need to create a file at <b>~/config/oracles.json</b>. 
As can be seen below, it takes an array of oracles with their addresses and names.

```json
{
  "agoric12345aaaaaaaaaa" : { "oracleName": "Oracle 1" },
  "agoric678910bbbbbbbbb" : { "oracleName": "Oracle 2" }
}
```

## To run both the middleware and monitoring script

```bash
docker-compose build
docker-compose up -d
```
