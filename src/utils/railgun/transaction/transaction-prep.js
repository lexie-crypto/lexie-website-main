/**
 * Transaction Preparation Utilities
 * Common logic for preparing RAILGUN transactions
 */

import { NetworkName } from '@railgun-community/shared-models';
import { waitForRailgunReady } from '../engine.js';

/**
 * Network mapping to Railgun NetworkName enum values
 */
const RAILGUN_NETWORK_NAMES = {
  1: NetworkName.Ethereum,
  42161: NetworkName.Arbitrum,
  137: NetworkName.Polygon,
  56: NetworkName.BNBChain,
};

/**
 * Get Railgun network name for a chain ID
 */
export const getRailgunNetworkName = (chainId) => {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Create ERC20AmountRecipient object for unshield
 */
export const createERC20AmountRecipient = (tokenAddress, amount, recipientAddress) => {
  const amountString = String(amount);

  if (!amount || amountString === '' || amountString === 'undefined' || amountString === 'null') {
    throw new Error(`Invalid amount for ERC20AmountRecipient: "${amount}"`);
  }

  let amountBigInt;
  try {
    amountBigInt = BigInt(amountString);
  } catch (error) {
    throw new Error(`Cannot convert amount "${amountString}" to BigInt: ${error.message}`);
  }

  return {
    tokenAddress: tokenAddress || undefined,
    amount: amountBigInt,
    recipientAddress: recipientAddress,
  };
};

/**
 * Refresh balances and scan network for a wallet
 */
export const refreshWalletBalances = async (railgunWalletID, chainId) => {
  console.log('🔄 [TX_PREP] Refreshing balances and scanning network...');

  try {
    const { refreshBalances } = await import('@railgun-community/wallet');
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');

    await waitForRailgunReady();

    const networkName = getRailgunNetworkName(chainId);
    const networkConfig = NETWORK_CONFIG[networkName];

    if (!networkConfig) {
      throw new Error(`No network config found for ${networkName}`);
    }

    const railgunChain = networkConfig.chain;
    const walletIdFilter = [railgunWalletID];

    console.log('🔄 [TX_PREP] Refreshing Railgun balances...');
    await refreshBalances(railgunChain, walletIdFilter);

  } catch (refreshError) {
    console.warn('⚠️ [TX_PREP] Balance refresh failed:', refreshError.message);
  }
};
