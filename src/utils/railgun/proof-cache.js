/**
 * RAILGUN Proof Cache - Official SDK Pattern
 * Adapted from: https://github.com/Railgun-Community/wallet/blob/main/src/services/transactions/proof-cache.ts
 * Converted to JavaScript for Lexie Wallet
 */

import {
  NetworkName,
  TXIDVersion,
} from '@railgun-community/shared-models';

/**
 * Cached proof transaction structure
 */
export class CachedProvedTransaction {
  constructor({
    proofType,
    txidVersion,
    networkName,
    railgunWalletID,
    erc20AmountRecipients,
    nftAmountRecipients,
    broadcasterFeeERC20AmountRecipient,
    sendWithPublicWallet,
    overallBatchMinGasPrice,
    transaction,
    nullifiers,
    preTransactionPOIsPerTxidLeafPerList,
    timestamp = Date.now(),
  }) {
    this.proofType = proofType;
    this.txidVersion = txidVersion;
    this.networkName = networkName;
    this.railgunWalletID = railgunWalletID;
    this.erc20AmountRecipients = erc20AmountRecipients;
    this.nftAmountRecipients = nftAmountRecipients;
    this.broadcasterFeeERC20AmountRecipient = broadcasterFeeERC20AmountRecipient;
    this.sendWithPublicWallet = sendWithPublicWallet;
    this.overallBatchMinGasPrice = overallBatchMinGasPrice;
    this.transaction = transaction;
    this.nullifiers = nullifiers;
    this.preTransactionPOIsPerTxidLeafPerList = preTransactionPOIsPerTxidLeafPerList;
    this.timestamp = timestamp;
  }
}

// Nested cache structure: cachedProofs[walletId][networkName]
const cachedProofs = {};

/**
 * Get network name from chain ID for caching
 * @param {number|string} chainId - Chain ID
 * @returns {string} Network name
 */
const getNetworkNameFromChainId = (chainId) => {
  const chainIdNum = Number(chainId);
  switch (chainIdNum) {
    case 1: return 'Ethereum';
    case 42161: return 'Arbitrum';
    case 137: return 'Polygon';
    case 56: return 'BNBChain';
    default: return `Chain${chainId}`;
  }
};

/**
 * Set cached proved transaction
 * @param {CachedProvedTransaction|null} provedTransaction - Proved transaction to cache
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 */
export const setCachedProvedTransaction = (provedTransaction, walletID, chainId) => {
  if (provedTransaction?.transaction?.from) {
    throw new Error('Cannot cache a transaction with a "from" address');
  }
  
  const networkName = getNetworkNameFromChainId(chainId);
  
  // Initialize wallet cache if it doesn't exist
  if (!cachedProofs[walletID]) {
    cachedProofs[walletID] = {};
  }
  
  if (provedTransaction) {
    cachedProofs[walletID][networkName] = provedTransaction;
  } else {
    delete cachedProofs[walletID][networkName];
    
    // Clean up empty wallet entries
    if (Object.keys(cachedProofs[walletID]).length === 0) {
      delete cachedProofs[walletID];
    }
  }
  
  console.log('[ProofCache] Cached proved transaction:', {
    walletID: walletID?.slice(0, 8) + '...',
    networkName,
    chainId,
    hasCache: !!provedTransaction,
    proofType: provedTransaction?.proofType,
    timestamp: provedTransaction?.timestamp,
    totalWallets: Object.keys(cachedProofs).length,
    networksForWallet: cachedProofs[walletID] ? Object.keys(cachedProofs[walletID]).length : 0,
  });
};

/**
 * Get cached proved transaction
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 * @returns {CachedProvedTransaction|null} Cached proved transaction
 */
export const getCachedProvedTransaction = (walletID, chainId) => {
  const networkName = getNetworkNameFromChainId(chainId);
  
  if (!cachedProofs[walletID] || !cachedProofs[walletID][networkName]) {
    return null;
  }
  
  return cachedProofs[walletID][networkName];
};

/**
 * Clear cached proved transaction
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 */
export const clearCachedProvedTransaction = (walletID, chainId) => {
  const networkName = getNetworkNameFromChainId(chainId);
  
  let deleted = false;
  if (cachedProofs[walletID] && cachedProofs[walletID][networkName]) {
    delete cachedProofs[walletID][networkName];
    deleted = true;
    
    // Clean up empty wallet entries
    if (Object.keys(cachedProofs[walletID]).length === 0) {
      delete cachedProofs[walletID];
    }
  }
  
  console.log('[ProofCache] Clearing cached proof:', {
    walletID: walletID?.slice(0, 8) + '...',
    networkName,
    chainId,
    deleted,
    remainingWallets: Object.keys(cachedProofs).length,
  });
};

/**
 * Check if cached proof is expired (older than 5 minutes)
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 * @returns {boolean} True if cache is expired
 */
export const isCachedProofExpired = (walletID, chainId) => {
  const cached = getCachedProvedTransaction(walletID, chainId);
  
  if (!cached) {
    return true;
  }
  
  const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
  const isExpired = Date.now() - cached.timestamp > fiveMinutes;
  
  if (isExpired) {
    console.log('[ProofCache] Cached proof is expired:', {
      walletID: walletID?.slice(0, 8) + '...',
      networkName: getNetworkNameFromChainId(chainId),
      age: Date.now() - cached.timestamp,
      limit: fiveMinutes,
    });
  }
  
  return isExpired;
};

/**
 * Compare ERC20 amount recipients arrays
 * @param {Array} arr1 - First array
 * @param {Array} arr2 - Second array
 * @returns {boolean} True if arrays match
 */
const compareERC20AmountRecipients = (arr1, arr2) => {
  if (!arr1 && !arr2) return true;
  if (!arr1 || !arr2) return false;
  if (arr1.length !== arr2.length) return false;
  
  return arr1.every((item1, index) => {
    const item2 = arr2[index];
    return (
      item1.tokenAddress === item2.tokenAddress &&
      item1.amount.toString() === item2.amount.toString() &&
      item1.recipientAddress === item2.recipientAddress
    );
  });
};

/**
 * Compare single ERC20 amount recipient
 * @param {Object} recipient1 - First recipient
 * @param {Object} recipient2 - Second recipient
 * @returns {boolean} True if recipients match
 */
const compareERC20AmountRecipient = (recipient1, recipient2) => {
  if (!recipient1 && !recipient2) return true;
  if (!recipient1 || !recipient2) return false;
  
  return (
    recipient1.tokenAddress === recipient2.tokenAddress &&
    recipient1.amount.toString() === recipient2.amount.toString() &&
    recipient1.recipientAddress === recipient2.recipientAddress
  );
};

/**
 * Validate cached proved transaction against new parameters (throws errors like official SDK)
 * @param {Object} params - Parameters to validate against
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 * @throws {Error} If validation fails
 */
export const validateCachedProvedTransaction = ({
  proofType,
  txidVersion,
  networkName,
  railgunWalletID,
  erc20AmountRecipients,
  nftAmountRecipients,
  broadcasterFeeERC20AmountRecipient,
  sendWithPublicWallet,
  overallBatchMinGasPrice,
}, walletID, chainId) => {
  const cached = getCachedProvedTransaction(walletID, chainId);
  
  if (!cached) {
    console.log('[ProofCache] ❌ No cached proof found for:', {
      walletID: walletID?.slice(0, 8) + '...',
      networkName: getNetworkNameFromChainId(chainId),
    });
    throw new Error('No proof found.');
  }
  
  if (isCachedProofExpired(walletID, chainId)) {
    console.log('[ProofCache] ❌ Cached proof is expired');
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Cached proof expired.');
  }
  
  // Detailed validation with specific error messages (like official SDK)
  if (cached.txidVersion !== txidVersion) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: txidVersion.');
  }
  
  if (cached.proofType !== proofType) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: proofType.');
  }
  
  if (cached.networkName !== networkName) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: networkName.');
  }
  
  if (cached.railgunWalletID !== railgunWalletID) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: railgunWalletID.');
  }
  
  if (cached.sendWithPublicWallet !== sendWithPublicWallet) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: sendWithPublicWallet.');
  }
  
  if (cached.overallBatchMinGasPrice !== overallBatchMinGasPrice) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: overallBatchMinGasPrice.');
  }
  
  if (!compareERC20AmountRecipients(cached.erc20AmountRecipients, erc20AmountRecipients)) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: erc20AmountRecipients.');
  }
  
  if (!(Array.isArray(cached.nftAmountRecipients) && Array.isArray(nftAmountRecipients) && 
        cached.nftAmountRecipients.length === nftAmountRecipients.length)) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: nftAmountRecipients.');
  }
  
  if (!compareERC20AmountRecipient(cached.broadcasterFeeERC20AmountRecipient, broadcasterFeeERC20AmountRecipient)) {
    clearCachedProvedTransaction(walletID, chainId);
    throw new Error('Mismatch: broadcasterFeeERC20AmountRecipient.');
  }
  
  console.log('[ProofCache] ✅ Cached proof validation passed for wallet/network');
};

/**
 * Get cached transaction for population
 * @param {Object} gasDetails - Gas details to apply to transaction
 * @param {string} walletID - Railgun wallet ID
 * @param {number|string} chainId - Chain ID
 * @returns {Object} Transaction data for population
 */
export const populateCachedTransaction = (gasDetails, walletID, chainId) => {
  const cached = getCachedProvedTransaction(walletID, chainId);
  
  if (!cached) {
    throw new Error(`No cached proof available for population: ${walletID?.slice(0, 8)}...@${getNetworkNameFromChainId(chainId)}`);
  }
  
  console.log('[ProofCache] 🔄 Populating transaction from cache:', {
    walletID: walletID?.slice(0, 8) + '...',
    networkName: getNetworkNameFromChainId(chainId),
    hasTransaction: !!cached.transaction,
    hasNullifiers: !!cached.nullifiers,
    hasPreTransactionPOIs: !!cached.preTransactionPOIsPerTxidLeafPerList,
    gasEstimate: gasDetails.gasEstimate?.toString(),
  });
  
  return {
    transaction: cached.transaction,
    nullifiers: cached.nullifiers,
    preTransactionPOIsPerTxidLeafPerList: cached.preTransactionPOIsPerTxidLeafPerList,
  };
};

/**
 * Populate proved transaction wrapper (like official SDK) - handles validation + population
 * SCALABLE: Works with our cachedProofs[walletId][networkName] structure for thousands of users
 * @param {string} txidVersion - Transaction ID version
 * @param {string} networkName - Network name
 * @param {string} proofType - Proof type
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {Array} erc20AmountRecipients - ERC20 recipients
 * @param {Array} nftAmountRecipients - NFT recipients
 * @param {Object} broadcasterFeeERC20AmountRecipient - Broadcaster fee
 * @param {boolean} sendWithPublicWallet - Send with public wallet
 * @param {bigint} overallBatchMinGasPrice - Overall batch min gas price
 * @param {Object} gasDetails - Gas details for transaction
 * @param {string} walletID - Railgun wallet ID (for our multi-user cache)
 * @param {number|string} chainId - Chain ID (for our multi-user cache)
 * @returns {Object} Transaction data from cache
 */
export const populateProvedTransaction = async (
  txidVersion,
  networkName,
  proofType,
  railgunWalletID,
  erc20AmountRecipients,
  nftAmountRecipients,
  broadcasterFeeERC20AmountRecipient,
  sendWithPublicWallet,
  overallBatchMinGasPrice,
  gasDetails,
  walletID,
  chainId
) => {
  try {
    // Validate cached proof (throws errors if invalid) - scoped to walletID + chainId
    validateCachedProvedTransaction({
      proofType,
      txidVersion,
      networkName,
      railgunWalletID,
      erc20AmountRecipients,
      nftAmountRecipients,
      broadcasterFeeERC20AmountRecipient,
      sendWithPublicWallet,
      overallBatchMinGasPrice,
    }, walletID, chainId);
    
    // Get cached transaction data from our scalable cache structure
    const cached = getCachedProvedTransaction(walletID, chainId);
    
    console.log('[ProofCache] ✅ Using valid cached proof for wallet/network:', {
      walletID: walletID?.slice(0, 8) + '...',
      networkName: getNetworkNameFromChainId(chainId),
      proofType: cached.proofType,
    });
    
    return {
      transaction: cached.transaction,
      nullifiers: cached.nullifiers,
      preTransactionPOIsPerTxidLeafPerList: cached.preTransactionPOIsPerTxidLeafPerList,
    };
    
  } catch (cause) {
    throw new Error(`Invalid proof for this transaction`, { cause });
  }
};

export default {
  setCachedProvedTransaction,
  getCachedProvedTransaction,
  clearCachedProvedTransaction,
  validateCachedProvedTransaction,
  populateCachedTransaction,
  isCachedProofExpired,
  CachedProvedTransaction,
}; 