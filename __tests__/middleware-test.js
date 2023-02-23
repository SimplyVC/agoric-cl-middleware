import { readJSONFile } from "../src/helpers/utils.js";
import {
  getOffers,
  checkSubmissionForRound,
  queryPrice,
  queryRound,
  getOraclesInvitations,
} from "../src/helpers/chain.js";
import { 
  iterateReverse, 
  makeLeader, 
  makeFollower 
} from "@agoric/casting";
import {
  boardSlottingMarshaller,
  makeAgoricNames,
  makeFromBoard,
  makeRpcUtils,
  makeVStorage,
} from "../src/lib/rpc.js";
import { getCurrent } from "../src/lib/wallet.js";
import sqlite3 from "sqlite3";

jest.mock("@agoric/casting", () => {
  return {
    iterateReverse: jest.fn(),
    makeLeader: jest.fn(),
    makeFollower: jest.fn(),
  };
});

jest.mock("sqlite3", () => {
  return {
    Database: jest.fn(),
  };
});

jest.mock("../src/helpers/chain.js", () => {
  const originalModule = jest.requireActual("../src/helpers/chain.js");
  return {
    ...originalModule,
    readVStorage: jest.fn(),
  };
});

jest.mock("../src/lib/rpc.js", () => {
  return {
    boardSlottingMarshaller: jest.fn(),
    networkConfig: {
      rpcAddrs: ["http://127.0.0.1:26657"],
      chainName: "agoriclocal",
    },
    makeAgoricNames: jest.fn(),
    makeVStorage: jest.fn(),
    makeFromBoard: jest.fn(),
    makeRpcUtils: jest.fn(),
  };
});

jest.mock("../src/lib/wallet.js", () => {
  return {
    getCurrent: jest.fn(),
  };
});

let iterateReverseOutput = readJSONFile(
  "__tests__/mock-objects/followerReversed.json"
);
let currentOutput = readJSONFile("__tests__/mock-objects/current.json");
let agoricNamesOutput = readJSONFile("__tests__/mock-objects/agoricNames.json");

const asyncIterator = {
  [Symbol.asyncIterator]: function () {
    let i = 0;
    return {
      next: () => {
        return new Promise((resolve) => {
          if (i < iterateReverseOutput.length) {
            resolve({ value: iterateReverseOutput[i++], done: false });
          } else {
            resolve({ done: true });
          }
        });
      },
    };
  },
};

iterateReverse.mockReturnValue(asyncIterator);
makeLeader.mockReturnValue({});
makeFollower.mockReturnValue({});
makeFromBoard.mockReturnValue({});
makeRpcUtils.mockReturnValue(
  Promise.resolve({
    agoricNames: agoricNamesOutput,
    fromBoard: {},
    vstorage: {},
  })
);
boardSlottingMarshaller.mockReturnValue({});
getCurrent.mockReturnValue(currentOutput);
makeAgoricNames.mockReturnValue(agoricNamesOutput);
sqlite3.Database.mockReturnValue({});

/**
 * Test for get offers
 */
test("calls getOffers to get latest successful submissions", async () => {
  const offers = await getOffers({});

  //notice how only the first offer should be calculated because for every offer there will be 3 entries
  expect(offers).toStrictEqual([
    {
      status: {
        id: 1676450914983,
        invitationSpec: {
          invitationArgs: [
            {
              roundId: 735,
              unitPrice: "13312851",
            },
          ],
          invitationMakerName: "PushPrice",
          previousOffer: 1675687989744,
          source: "continuing",
        },
        numWantsSatisfied: 1,
        payouts: {},
        proposal: {},
      },
      updated: "offerStatus",
    },
  ]);
});

/**
 * Test for check submission - with submission
 */
test("calls checkSubmissionForRound to check if there was a submission for round with submission", async () => {
  const submissionFound = await checkSubmissionForRound(
    "oracle1",
    1675687989744,
    735
  );

  expect(submissionFound).toBe(true);
});

/**
 * Test for check submission without submission
 */
test("calls checkSubmissionForRound to check if there was a submission for round without submission", async () => {
  const submissionFound = await checkSubmissionForRound(
    "oracle1",
    1675687989744,
    736
  );

  expect(submissionFound).toBe(false);
});

/**
 * Test for query price
 */
test("calls queryPrice to query the latest price", async () => {
  makeVStorage.mockReturnValue({
    readLatest: (key) =>
      JSON.stringify({
        value:
          '{"blockHeight":"161547","values":["{\\"body\\":\\"{\\\\\\"amountIn\\\\\\":{\\\\\\"brand\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"slot\\\\\\",\\\\\\"iface\\\\\\":\\\\\\"Alleged: ATOM brand\\\\\\",\\\\\\"index\\\\\\":0},\\\\\\"value\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"bigint\\\\\\",\\\\\\"digits\\\\\\":\\\\\\"1000000\\\\\\"}},\\\\\\"amountOut\\\\\\":{\\\\\\"brand\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"slot\\\\\\",\\\\\\"iface\\\\\\":\\\\\\"Alleged: USD brand\\\\\\",\\\\\\"index\\\\\\":1},\\\\\\"value\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"bigint\\\\\\",\\\\\\"digits\\\\\\":\\\\\\"14059528\\\\\\"}},\\\\\\"timer\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"slot\\\\\\",\\\\\\"iface\\\\\\":\\\\\\"Alleged: timerService\\\\\\",\\\\\\"index\\\\\\":2},\\\\\\"timestamp\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"bigint\\\\\\",\\\\\\"digits\\\\\\":\\\\\\"1676499385\\\\\\"}}\\",\\"slots\\":[\\"board05311\\",\\"board02810\\",null]}"]}',
      }),
  });

  const latestPrice = await queryPrice("ATOM-USD");

  expect(latestPrice).toBe(14.059528);
});

/**
 * Test for get oracle invitations
 */
test("calls getOraclesInvitations to get the invitation IDs", async () => {
  const invitations = await getOraclesInvitations("ATOM-USD");

  expect(invitations).toStrictEqual({
    "ATOM-USD": 1675687989744,
  });
});

/**
 * Test for query round
 */
test("calls queryRound to query the latest round", async () => {
  makeVStorage.mockReturnValue({
    readLatest: (key) =>
      JSON.stringify({
        value:
          '{"blockHeight":"161542","values":["{\\"body\\":\\"{\\\\\\"roundId\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"bigint\\\\\\",\\\\\\"digits\\\\\\":\\\\\\"802\\\\\\"},\\\\\\"startedAt\\\\\\":{\\\\\\"@qclass\\\\\\":\\\\\\"bigint\\\\\\",\\\\\\"digits\\\\\\":\\\\\\"1676499365\\\\\\"},\\\\\\"startedBy\\\\\\":\\\\\\"agoric1lw4e4aas9q84tq0q92j85rwjjjapf8dmnllnft\\\\\\"}\\",\\"slots\\":[]}"]}',
      }),
  });

  const latestPrice = await queryRound("ATOM-USD");

  expect(latestPrice).toStrictEqual({
    round_id: 802,
    started_at: 1676499365,
    started_by: "agoric1lw4e4aas9q84tq0q92j85rwjjjapf8dmnllnft",
    submission_made: false,
  });
});
