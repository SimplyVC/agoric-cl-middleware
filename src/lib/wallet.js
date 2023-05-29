
import { storageHelper } from './rpc.js';
import { boardSlottingMarshaller } from './rpc.js';

const marshaller = boardSlottingMarshaller();

/**
 * @param {string} addr
 * @param {import('./rpc').IdMap} ctx
 * @param {object} io
 * @param {import('./rpc.js').VStorage} io.vstorage
 * @returns {Promise<import('@agoric/smart-wallet/src/smartWallet').CurrentWalletRecord>}
 */
export const getCurrent = async (addr, ctx, { vstorage }) => {
  const capDataStr = await vstorage.readLatest(
    `published.wallet.${addr}.current`,
  );

  const capDatas = storageHelper.unserializeTxt(capDataStr, ctx);

  return capDatas[capDatas.length-1];
};

/**
 * @param {import('@agoric/smart-wallet/src/smartWallet').BridgeAction} bridgeAction
 * @param {Pick<import('stream').Writable,'write'>} [stdout]
 */
export const outputAction = (bridgeAction, stdout = process.stdout) => {
  const capData = marshaller.toCapData(harden(bridgeAction));
  stdout.write(JSON.stringify(capData));
  stdout.write('\n');
};