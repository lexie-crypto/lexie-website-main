/**
 * Get Public Balances Endpoint
 * Thin wrapper that uses the unified walletStorage.js handler
 */

import walletStorageHandler from '../walletStorage.js';

export const config = {
  api: {
    bodyParser: false, // Let walletStorage.js handle body parsing
  },
};

export default walletStorageHandler; 