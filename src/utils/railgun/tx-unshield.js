/**
 * RAILGUN Unshield Transactions - Clean Gas Relayer Pattern
 * - Single proof generation with correct recipients
 * - Gas relayer with public self-signing (stealth EOA)
 * - Clean fallback to user self-signing
 * - No Waku/broadcaster dependencies
 *
 * This file now serves as a clean interface to the refactored modules
 */

import { executeUnshieldTransaction } from './coordinators/unshield-coordinator.js';
import { privateTransferWithRelayer } from './private-transfer.js';
import { getRailgunNetworkName } from './transaction/transaction-prep.js';

/**
 * Main unshield function - now delegates to refactored coordinator
 */
export const unshieldTokens = async (params) => {
  return await executeUnshieldTransaction(params);
};

export default {
  unshieldTokens,
  privateTransferWithRelayer,
  getRailgunNetworkName,
};
