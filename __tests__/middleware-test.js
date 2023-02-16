jest.mock('@agoric/casting', () => {
    return {
        iterateReverse: jest.fn(),
        makeLeader: jest.fn(),
        makeFollower: jest.fn(),
    };
});

jest.mock('../src/lib/rpc.js', () => {
    return {
        boardSlottingMarshaller: jest.fn(),
        networkConfig: { rpcAddrs: ["http://127.0.0.1:26657"], chainName: "agoriclocal" },
        makeAgoricNames: jest.fn()
    };
});

jest.mock('../src/lib/wallet.js', () => {
    return {
        getCurrent: jest.fn(),
    };
});

jest.mock('../src/oracle/helper.js', () => {
    const originalModule = jest.requireActual("../src/oracle/helper")
    return {
        ...originalModule,
        readVStorage: jest.fn()
    };
});

import { readJSONFile, readVStorage } from '../src/oracle/helper.js';
import { getOffers, checkSubmissionForRound, queryPrice, queryRound, getOraclesInvitations } from '../src/oracle/middleware';
import { iterateReverse, makeLeader, makeFollower } from '@agoric/casting';
import { boardSlottingMarshaller, makeAgoricNames } from '../src/lib/rpc.js'
import { getCurrent } from '../src/lib/wallet.js'

let iterateReverseOutput = readJSONFile("__tests__/mock-objects/followerReversed.json")
let currentOutput = readJSONFile("__tests__/mock-objects/current.json")
let agoricNamesOutput = readJSONFile("__tests__/mock-objects/agoricNames.json")

const asyncIterator = {
    [Symbol.asyncIterator]: function() {
    let i = 0;
    return {
        next: () => {
        return new Promise(resolve => {
            if (i < iterateReverseOutput.length) {
            resolve({ value: iterateReverseOutput[i++], done: false });
            } else {
            resolve({ done: true });
            }
        });
        }
    };
    }
};

iterateReverse.mockReturnValue(asyncIterator)
makeLeader.mockReturnValue({})
makeFollower.mockReturnValue({})
boardSlottingMarshaller.mockReturnValue({})
getCurrent.mockReturnValue(currentOutput)
makeAgoricNames.mockReturnValue(agoricNamesOutput)

/**
 * Test for get offers
 */
test('calls getOffers to get latest successful submissions', async () => {
  
    const offers = await getOffers({});
  
    //notice how only the first offer should be calculated because for every offer there will be 3 entries
    expect(offers).toStrictEqual(
    [
        {
            "status": {
                "id": 1676450914983,
                "invitationSpec": {
                    "invitationArgs": [
                        {
                            "roundId": 735,
                            "unitPrice": "13312851"
                        }
                    ],
                    "invitationMakerName": "PushPrice",
                    "previousOffer": 1675687989744,
                    "source": "continuing"
                },
                "numWantsSatisfied": 1,
                "payouts": {},
                "proposal": {}
            },
            "updated": "offerStatus"
        }
    ]
    );
});

/**
 * Test for check submission - with submission
 */
test('calls checkSubmissionForRound to check if there was a submission for round with submission', async () => {
  
    const submissionFound = await checkSubmissionForRound("oracle1", 1675687989744, 735);
  
    expect(submissionFound).toBe(true);
});

/**
 * Test for check submission without submission
 */
test('calls checkSubmissionForRound to check if there was a submission for round without submission', async () => {
  
    const submissionFound = await checkSubmissionForRound("oracle1", 1675687989744, 736);
  
    expect(submissionFound).toBe(false);
});

/**
 * Test for query price
 */
test('calls queryPrice to query the latest price', async () => {

    readVStorage.mockReturnValue(JSON.stringify({"value": "{\"blockHeight\":\"161547\",\"values\":[\"{\\\"body\\\":\\\"{\\\\\\\"amountIn\\\\\\\":{\\\\\\\"brand\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"slot\\\\\\\",\\\\\\\"iface\\\\\\\":\\\\\\\"Alleged: ATOM brand\\\\\\\",\\\\\\\"index\\\\\\\":0},\\\\\\\"value\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"bigint\\\\\\\",\\\\\\\"digits\\\\\\\":\\\\\\\"1000000\\\\\\\"}},\\\\\\\"amountOut\\\\\\\":{\\\\\\\"brand\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"slot\\\\\\\",\\\\\\\"iface\\\\\\\":\\\\\\\"Alleged: USD brand\\\\\\\",\\\\\\\"index\\\\\\\":1},\\\\\\\"value\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"bigint\\\\\\\",\\\\\\\"digits\\\\\\\":\\\\\\\"14059528\\\\\\\"}},\\\\\\\"timer\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"slot\\\\\\\",\\\\\\\"iface\\\\\\\":\\\\\\\"Alleged: timerService\\\\\\\",\\\\\\\"index\\\\\\\":2},\\\\\\\"timestamp\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"bigint\\\\\\\",\\\\\\\"digits\\\\\\\":\\\\\\\"1676499385\\\\\\\"}}\\\",\\\"slots\\\":[\\\"board05311\\\",\\\"board02810\\\",null]}\"]}"}))
  
    const latestPrice = await queryPrice("ATOM-USD");
  
    expect(latestPrice).toBe(14.059528);
});

/**
 * Test for get oracle invitations
 */
test('calls getOraclesInvitations to get the invitation IDs', async () => {

    const invitations = await getOraclesInvitations("ATOM-USD");
  
    expect(invitations).toStrictEqual({
        "ATOM-USD": 1675687989744
    });
});

/**
 * Test for query round
 */
test('calls queryRound to query the latest round', async () => {

    readVStorage.mockReturnValue(JSON.stringify({"value": "{\"blockHeight\":\"161542\",\"values\":[\"{\\\"body\\\":\\\"{\\\\\\\"roundId\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"bigint\\\\\\\",\\\\\\\"digits\\\\\\\":\\\\\\\"802\\\\\\\"},\\\\\\\"startedAt\\\\\\\":{\\\\\\\"@qclass\\\\\\\":\\\\\\\"bigint\\\\\\\",\\\\\\\"digits\\\\\\\":\\\\\\\"1676499365\\\\\\\"},\\\\\\\"startedBy\\\\\\\":\\\\\\\"agoric1lw4e4aas9q84tq0q92j85rwjjjapf8dmnllnft\\\\\\\"}\\\",\\\"slots\\\":[]}\"]}"}))
  
    const latestPrice = await queryRound("ATOM-USD");
  
    expect(latestPrice).toStrictEqual({
        "roundId": 802, 
        "startedAt": 1676499365, 
        "startedBy": "agoric1lw4e4aas9q84tq0q92j85rwjjjapf8dmnllnft", 
        "submissionMade": false
    });
});