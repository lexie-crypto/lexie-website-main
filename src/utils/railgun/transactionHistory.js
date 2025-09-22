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
import { formatUnits } from 'ethers';
import { NetworkName, NETWORK_CONFIG } from '@railgun-community/shared-models';
import { waitForRailgunReady } from './engine.js';
import { getCurrentWalletID } from './wallet.js';

/**
 * Network mapping for Railgun - using proper NetworkName enum values
 */
const RAILGUN_NETWORK_NAMES = {
  1: NetworkName.Ethereum,
  42161: NetworkName.Arbitrum, 
  137: NetworkName.Polygon,
  56: NetworkName.BNBChain,
};

/**
 * Get Railgun network name from chain ID
 */
const getRailgunNetworkName = (chainId) => {
  const networkName = RAILGUN_NETWORK_NAMES[chainId];
  if (!networkName) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return networkName;
};

/**
 * Get chain configuration for network
 */
const getChainConfig = (networkName) => {
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
 * Look up Lexie ID for a Railgun address
 * @param {string} railgunAddress - Railgun address to look up
 * @returns {Promise<string|null>} Lexie ID or null if not found
 */
const lookupLexieId = async (railgunAddress) => {
  if (!railgunAddress || typeof railgunAddress !== 'string') {
    return null;
  }

  try {
    console.log('🔍 [LEXIE_LOOKUP] Looking up Lexie ID for:', railgunAddress.slice(0, 10) + '...');

    const response = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(railgunAddress)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.warn('🔍 [LEXIE_LOOKUP] Lookup failed:', response.status, response.statusText);
      return null;
    }

    const data = await response.json();

    if (data.success && data.lexieID) {
      console.log('✅ [LEXIE_LOOKUP] Found Lexie ID:', data.lexieID, 'for address:', railgunAddress.slice(0, 10) + '...');
      return data.lexieID;
    } else {
      console.log('ℹ️ [LEXIE_LOOKUP] No Lexie ID found for address:', railgunAddress.slice(0, 10) + '...');
      return null;
    }
  } catch (error) {
    console.warn('❌ [LEXIE_LOOKUP] Error looking up Lexie ID:', error.message);
    return null;
  }
};

/**
 * Format transaction history item for UI display
 * @param {Object} historyItem - Raw history item from RAILGUN
 * @param {number} chainId - Chain ID
 * @returns {Object} Formatted transaction object
 */
const formatTransactionHistoryItem = async (historyItem, chainId) => {
  const {
    txid,
    blockNumber,
    timestamp,
    transferERC20Amounts = [],
    receiveERC20Amounts = [],
    unshieldERC20Amounts = [],
    category,
    memo,
  } = historyItem;

  // Extract memoText from historyItem (not as const since we may reassign it)
  let memoText = historyItem.memoText;

  // Debug: Log all available fields in historyItem for private transfers
  if (category === TransactionCategory.TRANSFER_SEND || category === TransactionCategory.TRANSFER_RECEIVE) {
    console.log('🔍 [TRANSACTION_HISTORY] Full historyItem fields for private transfer:', {
      txid: txid?.substring(0, 10) + '...',
      allKeys: Object.keys(historyItem),
      memo: historyItem.memo,
      memoText: historyItem.memoText,
      memoTextType: typeof historyItem.memoText,
      memoType: typeof historyItem.memo,
      // Check for any other memo-related fields
      ...Object.keys(historyItem).filter(key => key.toLowerCase().includes('memo')).reduce((obj, key) => {
        obj[key] = historyItem[key];
        return obj;
      }, {})
    });
  }

  // Determine transaction type and primary amounts
  let transactionType = 'Unknown';
  let primaryAmounts = [];
  let description = '';

  switch (category) {
    case TransactionCategory.SHIELD:
      transactionType = 'Add to Vault';
      primaryAmounts = receiveERC20Amounts;
      description = 'Add tokens to vault';
      break;
      
    case TransactionCategory.UNSHIELD:
      transactionType = 'Remove from Vault';
      primaryAmounts = unshieldERC20Amounts;
      description = 'Remove tokens from vault';
      break;
      
    case TransactionCategory.TRANSFER_SEND:
      transactionType = 'Send Transaction';
      primaryAmounts = transferERC20Amounts;
      description = 'Send transaction';
      break;
      
    case TransactionCategory.TRANSFER_RECEIVE:
      transactionType = 'Receive Transaction';
      primaryAmounts = receiveERC20Amounts;
      description = 'Receive transaction';
      break;

    default:
      transactionType = 'Unknown';
      primaryAmounts = [...transferERC20Amounts, ...receiveERC20Amounts, ...unshieldERC20Amounts];
      description = 'Unknown transaction type';
  }

  // Add detailed logging for transfer transactions
  if (category === TransactionCategory.TRANSFER_SEND || category === TransactionCategory.TRANSFER_RECEIVE) {
    console.log('📊 [TRANSACTION_HISTORY] Processing transfer transaction:', {
      category,
      transactionType,
      transferERC20AmountsCount: transferERC20Amounts?.length || 0,
      receiveERC20AmountsCount: receiveERC20Amounts?.length || 0,
      primaryAmountsCount: primaryAmounts?.length || 0,
      txid: txid?.substring(0, 10) + '...',
      transferDetails: transferERC20Amounts?.map(amount => ({
        tokenAddress: amount.tokenAddress,
        amount: amount.amount?.toString(),
        recipientAddress: amount.recipientAddress?.substring(0, 30) + '...',
        recipientLength: amount.recipientAddress?.length
      })),
      receiveDetails: receiveERC20Amounts?.map(amount => ({
        tokenAddress: amount.tokenAddress,
        amount: amount.amount?.toString(),
        recipientAddress: amount.recipientAddress?.substring(0, 30) + '...',
        recipientLength: amount.recipientAddress?.length
      }))
    });
  }

  // Format token amounts for display
  const tokenAmounts = primaryAmounts.map(amount => {
    const tokenAddress = amount.tokenAddress || amount.address;
    const rawAmount = amount.amount || amount.value || '0';

    return {
      tokenAddress,
      amount: rawAmount?.toString() || '0',
      symbol: getTokenSymbol(tokenAddress, chainId),
      decimals: getTokenDecimals(tokenAddress, chainId),
      formattedAmount: formatTokenAmount(rawAmount?.toString() || '0', getTokenDecimals(tokenAddress, chainId))
    };
  });

  // Determine if this is a private transfer (send or receive)
  const isPrivateTransfer = category === TransactionCategory.TRANSFER_SEND || category === TransactionCategory.TRANSFER_RECEIVE;

  // Initialize recipient/sender address and lexie id for private transfers
  let recipientAddress = null;
  let senderAddress = null;
  let recipientLexieId = null;
  let senderLexieId = null;

  // Get memo and address information for private transfers - memo is stored in the amount objects, not at top level
  if (isPrivateTransfer) {
    console.log('📝 [TRANSACTION_HISTORY] Processing memo and address for private transfer:', {
      txid: txid?.substring(0, 10) + '...',
      category,
      hasMemoText: !!historyItem.memoText,
      hasMemo: !!historyItem.memo,
      // Check memo and address in amount objects
      transferAmounts: transferERC20Amounts?.length || 0,
      receiveAmounts: receiveERC20Amounts?.length || 0,
      firstTransferMemo: transferERC20Amounts?.[0]?.memoText,
      firstReceiveMemo: receiveERC20Amounts?.[0]?.memoText,
      firstTransferRecipient: transferERC20Amounts?.[0]?.recipientAddress,
      firstReceiveSender: receiveERC20Amounts?.[0]?.senderAddress
    });

    // For transfer transactions, memo and recipient address are in the first transferERC20Amounts item
    if (category === TransactionCategory.TRANSFER_SEND && transferERC20Amounts?.length > 0) {
      const transferMemo = transferERC20Amounts[0].memoText;
      const transferRecipient = transferERC20Amounts[0].recipientAddress;

      if (typeof transferMemo === 'string' && transferMemo.length > 0) {
        memoText = transferMemo;
        console.log('📝 [TRANSACTION_HISTORY] Found memo in transfer amount:', memoText);
      }

      if (transferRecipient) {
        recipientAddress = transferRecipient;
        console.log('📧 [TRANSACTION_HISTORY] Found recipient address in transfer:', recipientAddress);

        // Look up Lexie ID for recipient (this will be awaited later)
        recipientLexieId = await lookupLexieId(transferRecipient);
      }
    }
    // For receive transactions, memo and sender address are in the first receiveERC20Amounts item
    else if (category === TransactionCategory.TRANSFER_RECEIVE && receiveERC20Amounts?.length > 0) {
      const receiveMemo = receiveERC20Amounts[0].memoText;
      const receiveSender = receiveERC20Amounts[0].senderAddress;

      if (typeof receiveMemo === 'string' && receiveMemo.length > 0) {
        memoText = receiveMemo;
        console.log('📝 [TRANSACTION_HISTORY] Found memo in receive amount:', memoText);
      }

      if (receiveSender) {
        senderAddress = receiveSender;
        console.log('📧 [TRANSACTION_HISTORY] Found sender address in receive:', senderAddress);

        // Look up Lexie ID for sender (this will be awaited later)
        senderLexieId = await lookupLexieId(receiveSender);
      }
    }

    // Fallback: check top-level fields (for backward compatibility)
    if (!memoText) {
      if (typeof historyItem.memoText === 'string' && historyItem.memoText.length > 0) {
        memoText = historyItem.memoText;
        console.log('📝 [TRANSACTION_HISTORY] Using top-level memoText field:', memoText);
      } else if (typeof historyItem.memo === 'string' && historyItem.memo.length > 0) {
        memoText = historyItem.memo;
        console.log('📝 [TRANSACTION_HISTORY] Using top-level memo field:', memoText);
      }
    }

    if (!memoText) {
      console.log('📝 [TRANSACTION_HISTORY] No memo found for private transfer');
    }
  } else {
    memoText = null; // Not a private transfer, so no memo
  }

  // Copy function for transaction ID
  const copyTxId = async () => {
    try {
      await navigator.clipboard.writeText(txid);
      console.log('[TransactionHistory] ✅ Transaction ID copied to clipboard:', txid);
      // You can add a toast notification here if desired
    } catch (error) {
      console.error('[TransactionHistory] ❌ Failed to copy transaction ID:', error);
    }
  };

  return {
    txid,
    blockNumber,
    timestamp,
    date: timestamp ? new Date(timestamp * 1000) : null,
    transactionType,
    category,
    description,
    memo: memoText,
    isPrivateTransfer,
    recipientAddress: recipientAddress, // For send transactions
    senderAddress: senderAddress, // For receive transactions
    recipientLexieId: recipientLexieId, // Lexie ID for recipient
    senderLexieId: senderLexieId, // Lexie ID for sender
    tokenAmounts,
    chainId,
    // Copy functionality
    copyTxId,
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
  if (!tokenAddress) return 'UNKNOWN';

  // Debug logging
  console.log('[TransactionHistory] getTokenSymbol called:', {
    tokenAddress,
    chainId,
    normalized: tokenAddress?.toLowerCase()
  });

  // Handle native token (multiple representations)
  const normalizedTokenAddress = tokenAddress?.toLowerCase();
  const nativeAddresses = [
    '0x0000000000000000000000000000000000000000', // Zero address
    '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',   // EEE address
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',   // Checksummed EEE
    '',                                             // Empty string
  ];

  if (!tokenAddress ||
      nativeAddresses.includes(tokenAddress) ||
      nativeAddresses.includes(normalizedTokenAddress)) {
    const nativeSymbols = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
    return nativeSymbols[chainId] || 'ETH';
  }

  // Normalize address for comparison
  const normalizedAddress = tokenAddress.toLowerCase();

  // Known tokens by network (expanded list)
  const knownTokens = {
    // Ethereum
    1: {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC', // This is the address from the user's screenshot
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'WBTC',
      '0x514910771af9ca656af840dff83e8264ecf986ca': 'LINK',
      '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'UNI',
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'AAVE',
    },
    // Arbitrum
    42161: {
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH',
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 'DAI',
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 'WBTC',
      '0xfa7f8980b0f1e64a2062791cc3b087ef6cd93df': 'UNI',
    },
    // BNB Chain
    56: {
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8': 'WETH',
      '0x55d398326f99059ff775485246999027b3197955': 'USDT',
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 'DAI',
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': 'BTCB',
    },
    // Polygon
    137: {
      '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETH',
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 'DAI',
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 'WBTC',
    }
  };

  const chainTokens = knownTokens[chainId];
  if (chainTokens && chainTokens[normalizedAddress]) {
    return chainTokens[normalizedAddress];
  }

  // Try to extract symbol from contract if possible (fallback)
  console.warn('[TransactionHistory] Unknown token:', { tokenAddress, chainId });

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
  
  // Known token decimals by network
  const knownDecimals = {
    // Ethereum
    1: {
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 18, // WETH
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 6,  // USDT
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 6,  // USDC
      '0x6b175474e89094c44da98b954eedeac495271d0f': 18, // DAI
      '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 8,  // WBTC
      '0x514910771af9ca656af840dff83e8264ecf986ca': 18, // LINK
      '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 18, // UNI
      '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 18, // AAVE
    },
    // Arbitrum
    42161: {
      '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,  // USDC
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6,  // USDT
      '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
      '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8,  // WBTC
      '0xfa7f8980b0f1e64a2062791cc3b087ef6cd93df': 18, // UNI
    },
    // BNB Chain
    56: {
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8': 18, // WETH
      '0x55d398326f99059ff775485246999027b3197955': 18, // USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18, // USDC
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3': 18, // DAI
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c': 18, // BTCB
    },
    // Polygon
    137: {
      '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 18, // WETH
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 6,  // USDT
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 6,  // USDC
      '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063': 18, // DAI
      '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 8,  // WBTC
    }
  };
  
  const chainDecimals = knownDecimals[chainId];
  if (chainDecimals) {
    return chainDecimals[tokenAddress.toLowerCase()] || 18;
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
 * Get transaction history for a RAILGUN wallet (filtered by chain)
 * @param {string} walletID - RAILGUN wallet ID
 * @param {number} chainId - Chain ID to filter by
 * @param {number} startingBlock - Optional starting block number
 * @returns {Array} Array of formatted transaction history items for the specified chain
 */
export const getTransactionHistory = async (walletID, chainId, startingBlock = null) => {
  try {
    await waitForRailgunReady();
    
    const networkName = getRailgunNetworkName(chainId);
    const { chain } = getChainConfig(networkName);
    
    console.log('[TransactionHistory] Fetching transaction history for chain:', {
      walletID: walletID?.slice(0, 8) + '...',
      chainId,
      networkName,
      chainConfig: `${chain.id}-${chain.type}`,
      startingBlock,
      note: 'Only transactions for this specific chain will be returned'
    });
    
    // Check wallet scanning status before fetching history
    try {
      const { getWalletScanningProgress } = await import('@railgun-community/wallet');
      const scanProgress = await getWalletScanningProgress(chain, walletID);
      console.log('[TransactionHistory] Wallet scan progress:', {
        walletID: walletID?.slice(0, 8) + '...',
        chainId,
        scanProgress: scanProgress || 'unknown'
      });
    } catch (scanError) {
      console.warn('[TransactionHistory] Could not check scan progress:', scanError?.message || scanError);
    }
    
    // Get raw transaction history from RAILGUN
    const rawHistory = await getWalletTransactionHistory(
      chain,
      walletID,
      startingBlock
    );
    
    console.log('[TransactionHistory] Raw history received:', {
      count: rawHistory.length,
      types: rawHistory.map(item => item.category),
      userAgent: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop',
      // Debug memo fields for private transfers
      privateTransfers: rawHistory.filter(item =>
        item.category === TransactionCategory.TRANSFER_SEND ||
        item.category === TransactionCategory.TRANSFER_RECEIVE
      ).map(item => ({
        category: item.category,
        txid: item.txid?.substring(0, 10) + '...',
        hasMemoText: !!item.memoText,
        hasMemo: !!item.memo,
        memoTextLength: item.memoText?.length || 0,
        memoLength: item.memo?.length || 0,
        memoTextPreview: item.memoText?.substring(0, 20) + (item.memoText?.length > 20 ? '...' : ''),
        memoPreview: item.memo?.substring(0, 20) + (item.memo?.length > 20 ? '...' : '')
      }))
    });
    
    // Format for UI display (handle async Lexie ID lookups)
    const formattedHistory = await Promise.all(
      rawHistory.map(item => formatTransactionHistoryItem(item, chainId))
    );
    
    // Sort by timestamp (most recent first)
    formattedHistory.sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return b.timestamp - a.timestamp;
    });
    
    console.log('[TransactionHistory] ✅ Formatted transaction history for chain:', {
      chainId,
      count: formattedHistory.length,
      types: formattedHistory.map(item => item.transactionType),
      privateTransfersWithMemo: formattedHistory.filter(item => item.isPrivateTransfer && item.memo).length,
      dateRange: formattedHistory.length > 0 ? {
        latest: formattedHistory[0]?.date?.toLocaleString(),
        earliest: formattedHistory[formattedHistory.length - 1]?.date?.toLocaleString()
      } : null,
      features: {
        copyTxId: true,
        chainFiltered: true,
        privateTransferMemos: true
      }
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
 * Get transaction history for current wallet on specific chain (convenience function)
 * @param {number} chainId - Chain ID to get transactions for
 * @returns {Array} Transaction history for current wallet on specified chain
 */
export const getCurrentWalletTransactionHistory = async (chainId) => {
  try {
    const walletID = getCurrentWalletID();
    if (!walletID) {
      throw new Error('No active RAILGUN wallet');
    }

    console.log('[TransactionHistory] Getting current wallet history for chain:', chainId);
    return await getTransactionHistory(walletID, chainId);
  } catch (error) {
    console.error('[TransactionHistory] Failed to get current wallet history:', error);
    return [];
  }
};

/**
 * Get transaction history for current wallet on current chain only
 * @param {number} chainId - Current chain ID
 * @returns {Array} Transaction history filtered to current chain
 */
export const getCurrentChainTransactionHistory = async (chainId) => {
  console.log('[TransactionHistory] 🔍 Getting transaction history for current chain only:', chainId);
  return await getCurrentWalletTransactionHistory(chainId);
};

/**
 * Create UI-ready transaction item with copy functionality and memo display
 * @param {Object} transaction - Raw transaction object
 * @returns {Object} UI-ready transaction with enhanced features
 */
export const createUITransactionItem = (transaction) => {
  return {
    ...transaction,
    // Transaction ID with copy functionality
    txIdDisplay: {
      id: transaction.txid,
      shortId: `${transaction.txid.slice(0, 8)}...${transaction.txid.slice(-6)}`,
      fullId: transaction.txid,
      copy: transaction.copyTxId
    },
    // Memo display for private transfers
    memoDisplay: transaction.isPrivateTransfer && transaction.memo ? {
      text: transaction.memo,
      truncated: transaction.memo.length > 50 ? `${transaction.memo.slice(0, 50)}...` : transaction.memo,
      full: transaction.memo
    } : null,
    // Recipient/Sender address display for private transfers
    addressDisplay: transaction.isPrivateTransfer ? {
      recipient: transaction.recipientAddress ? {
        full: transaction.recipientAddress,
        short: `${transaction.recipientAddress.slice(0, 8)}...${transaction.recipientAddress.slice(-6)}`,
        lexieId: transaction.recipientLexieId,
        display: transaction.recipientLexieId || `${transaction.recipientAddress.slice(0, 8)}...${transaction.recipientAddress.slice(-6)}`,
        type: 'recipient'
      } : null,
      sender: transaction.senderAddress ? {
        full: transaction.senderAddress,
        short: `${transaction.senderAddress.slice(0, 8)}...${transaction.senderAddress.slice(-6)}`,
        lexieId: transaction.senderLexieId,
        display: transaction.senderLexieId || `${transaction.senderAddress.slice(0, 8)}...${transaction.senderAddress.slice(-6)}`,
        type: 'sender'
      } : null
    } : null,
    // Chain information
    chainInfo: {
      id: transaction.chainId,
      name: getChainName(transaction.chainId)
    }
  };
};

/**
 * Get chain name for display
 * @param {number} chainId - Chain ID
 * @returns {string} Human-readable chain name
 */
const getChainName = (chainId) => {
  const chainNames = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNB Chain'
  };
  return chainNames[chainId] || `Chain ${chainId}`;
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
  getCurrentChainTransactionHistory,
  getShieldTransactions,
  getUnshieldTransactions,
  getPrivateTransfers,
  createUITransactionItem,
  TransactionCategory,
}; 