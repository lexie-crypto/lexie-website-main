/**
 * RAILGUN Transaction History Integration
 * Based on wallet/src/services/railgun/history/transaction-history.ts
 * 
 * Provides historical private transaction data including:
 * - Shield transactions
 * - Unshield transactions  
 * - Private transfers
 * - Transaction categorization
 */

import { getWalletTransactionHistory } from '@railgun-community/wallet';
import { waitForRailgunReady } from './engine.js';
import { getCurrentWalletID } from './wallet.js';

/**
 * Network mapping for Railgun
 */
const NETWORK_MAPPING = {
  1: 'Ethereum',
  42161: 'Arbitrum', 
  137: 'Polygon',
  56: 'BNBChain',
};

/**
 * Get Railgun network name from chain ID
 */
const getRailgunNetworkName = (chainId) => {
  const networkName = NETWORK_MAPPING[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Get chain configuration for network
 */
const getChainConfig = (networkName) => {
  const { NETWORK_CONFIG } = require('@railgun-community/shared-models');
  return NETWORK_CONFIG[networkName];
};

/**
 * Transaction categories for UI display
 */
export const TransactionCategory = {
  SHIELD: 'ShieldERC20s',
  UNSHIELD: 'UnshieldERC20s', 
  TRANSFER_SEND: 'TransferSendERC20s',
  TRANSFER_RECEIVE: 'TransferReceiveERC20s',
  UNKNOWN: 'Unknown'
};

/**
 * Format transaction history item for UI display
 * @param {Object} historyItem - Raw history item from RAILGUN
 * @param {number} chainId - Chain ID
 * @returns {Object} Formatted transaction object
 */
const formatTransactionHistoryItem = (historyItem, chainId) => {
  const {
    txid,
    blockNumber,
    timestamp,
    transferERC20Amounts = [],
    receiveERC20Amounts = [],
    unshieldERC20Amounts = [],
    category
  } = historyItem;

  // Determine transaction type and primary amounts
  let transactionType = 'Unknown';
  let primaryAmounts = [];
  let description = '';

  switch (category) {
    case TransactionCategory.SHIELD:
      transactionType = 'Shield';
      primaryAmounts = receiveERC20Amounts;
      description = 'Shielded tokens for privacy';
      break;
      
    case TransactionCategory.UNSHIELD:
      transactionType = 'Unshield';
      primaryAmounts = unshieldERC20Amounts;
      description = 'Unshielded tokens to public';
      break;
      
    case TransactionCategory.TRANSFER_SEND:
      transactionType = 'Private Send';
      primaryAmounts = transferERC20Amounts;
      description = 'Private transfer sent';
      break;
      
    case TransactionCategory.TRANSFER_RECEIVE:
      transactionType = 'Private Receive';
      primaryAmounts = receiveERC20Amounts;
      description = 'Private transfer received';
      break;
      
    default:
      transactionType = 'Unknown';
      primaryAmounts = [...transferERC20Amounts, ...receiveERC20Amounts, ...unshieldERC20Amounts];
      description = 'Unknown transaction type';
  }

  // Format token amounts for display
  const tokenAmounts = primaryAmounts.map(amount => ({
    tokenAddress: amount.tokenAddress,
    amount: amount.amount?.toString() || '0',
    symbol: getTokenSymbol(amount.tokenAddress, chainId),
    decimals: getTokenDecimals(amount.tokenAddress, chainId),
    formattedAmount: formatTokenAmount(amount.amount?.toString() || '0', getTokenDecimals(amount.tokenAddress, chainId))
  }));

  return {
    txid,
    blockNumber,
    timestamp,
    date: timestamp ? new Date(timestamp * 1000) : null,
    transactionType,
    category,
    description,
    tokenAmounts,
    chainId,
    // Raw data for detailed view
    raw: {
      transferERC20Amounts,
      receiveERC20Amounts, 
      unshieldERC20Amounts,
      broadcasterFeeERC20Amount: historyItem.broadcasterFeeERC20Amount,
      changeERC20Amounts: historyItem.changeERC20Amounts || []
    }
  };
};

/**
 * Get token symbol for display
 * @param {string} tokenAddress - Token address  
 * @param {number} chainId - Chain ID
 * @returns {string} Token symbol
 */
const getTokenSymbol = (tokenAddress, chainId) => {
  if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
    const nativeSymbols = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
    return nativeSymbols[chainId] || 'ETH';
  }
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
    };
    return knownTokens[tokenAddress.toLowerCase()] || 'UNKNOWN';
  }
  
  return 'UNKNOWN';
};

/**
 * Get token decimals
 * @param {string} tokenAddress - Token address
 * @param {number} chainId - Chain ID  
 * @returns {number} Token decimals
 */
const getTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return 18; // Native tokens
  
  // Known tokens on Arbitrum
  if (chainId === 42161) {
    const knownTokens = {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
    };
    return knownTokens[tokenAddress.toLowerCase()] || 18;
  }
  
  return 18; // Default
};

/**
 * Format token amount for display
 * @param {string} amount - Raw amount string
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted amount
 */
const formatTokenAmount = (amount, decimals) => {
  try {
    if (!amount || amount === '0') return '0';
    
    const { formatUnits } = require('ethers');
    const formatted = formatUnits(amount, decimals);
    const num = parseFloat(formatted);
    
    if (num === 0) return '0';
    
    // Format with appropriate decimal places
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals > 6 ? 6 : decimals,
    });
    
  } catch (error) {
    console.error('[TransactionHistory] Amount formatting failed:', error);
    return '0';
  }
};

/**
 * Get transaction history for a RAILGUN wallet
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @param {number} startingBlock - Optional starting block number
 * @returns {Array} Array of formatted transaction history items
 */
export const getTransactionHistory = async (walletID, chainId, startingBlock = null) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    const { chain } = getChainConfig(networkName);
    
    console.log('[TransactionHistory] Fetching transaction history:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
      networkName,
      startingBlock
    });
    
    // Get raw transaction history from RAILGUN
    const rawHistory = await getWalletTransactionHistory(
      chain,
      walletID,
      startingBlock
    );
    
    console.log('[TransactionHistory] Raw history received:', {
      count: rawHistory.length,
      types: rawHistory.map(item => item.category)
    });
    
    // Format for UI display
    const formattedHistory = rawHistory.map(item => 
      formatTransactionHistoryItem(item, chainId)
    );
    
    // Sort by timestamp (most recent first)
    formattedHistory.sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return b.timestamp - a.timestamp;
    });
    
    console.log('[TransactionHistory] ✅ Formatted transaction history:', {
      count: formattedHistory.length,
      types: formattedHistory.map(item => item.transactionType),
      dateRange: formattedHistory.length > 0 ? {
        latest: formattedHistory[0]?.date?.toLocaleString(),
        earliest: formattedHistory[formattedHistory.length - 1]?.date?.toLocaleString()
      } : null
    });
    
    return formattedHistory;
    
  } catch (error) {
    console.error('[TransactionHistory] Failed to get transaction history:', error);
    throw new Error(`Transaction history fetch failed: ${error.message}`);
  }
};

/**
 * Get recent transaction history (last 50 transactions)
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Recent transactions
 */
export const getRecentTransactionHistory = async (walletID, chainId) => {
  try {
    const history = await getTransactionHistory(walletID, chainId);
    return history.slice(0, 50); // Return last 50 transactions
  } catch (error) {
    console.error('[TransactionHistory] Failed to get recent history:', error);
    return [];
  }
};

/**
 * Get transaction history by category
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @param {string} category - Transaction category to filter by
 * @returns {Array} Filtered transactions
 */
export const getTransactionHistoryByCategory = async (walletID, chainId, category) => {
  try {
    const history = await getTransactionHistory(walletID, chainId);
    return history.filter(tx => tx.category === category);
  } catch (error) {
    console.error('[TransactionHistory] Failed to get categorized history:', error);
    return [];
  }
};

/**
 * Get transaction history for current wallet (convenience function)
 * @param {number} chainId - Chain ID
 * @returns {Array} Transaction history for current wallet
 */
export const getCurrentWalletTransactionHistory = async (chainId) => {
  try {
    const walletID = getCurrentWalletID();
    if (!walletID) {
      throw new Error('No active RAILGUN wallet');
    }
    
    return await getTransactionHistory(walletID, chainId);
  } catch (error) {
    console.error('[TransactionHistory] Failed to get current wallet history:', error);
    return [];
  }
};

/**
 * Get shield transactions only
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Shield transactions
 */
export const getShieldTransactions = async (walletID, chainId) => {
  return await getTransactionHistoryByCategory(walletID, chainId, TransactionCategory.SHIELD);
};

/**
 * Get unshield transactions only
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Unshield transactions
 */
export const getUnshieldTransactions = async (walletID, chainId) => {
  return await getTransactionHistoryByCategory(walletID, chainId, TransactionCategory.UNSHIELD);
};

/**
 * Get private transfer transactions only
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Array} Private transfer transactions
 */
export const getPrivateTransfers = async (walletID, chainId) => {
  const history = await getTransactionHistory(walletID, chainId);
  return history.filter(tx => 
    tx.category === TransactionCategory.TRANSFER_SEND || 
    tx.category === TransactionCategory.TRANSFER_RECEIVE
  );
};

// Export for use in other modules
export default {
  getTransactionHistory,
  getRecentTransactionHistory,
  getTransactionHistoryByCategory,
  getCurrentWalletTransactionHistory,
  getShieldTransactions,
  getUnshieldTransactions,
  getPrivateTransfers,
  TransactionCategory,
}; 