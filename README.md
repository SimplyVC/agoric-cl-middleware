# Agoric Oracle Middleware

## Create oracle.json file

In order to monitor oracles, you need to create a file at <b>~/config/oracle.json</b>. 
As can be seen below, it takes an array of oracles with their addresses and names.

```json
{
  "agoric12345aaaaaaaaaa" : { "oracleName": "Oracle 1" },
  "agoric678910bbbbbbbbb" : { "oracleName": "Oracle 2" }
}
```

## To build oracle middleware

```bash
docker build --tag ag-oracle-middleware -f Dockerfile.middleware .
```
## To build oracle monitor

```bash
docker build --tag ag-oracle-monitor -f Dockerfile.monitor .
```
