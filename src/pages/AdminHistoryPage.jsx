import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { formatUnits } from 'ethers';
import './AdminHistoryPage.css';

// Import RAILGUN transaction history utilities
import { getTransactionHistory, TransactionCategory } from '../utils/railgun/transactionHistory.js';

// Railgun SDK components will be imported dynamically

/**
 * Get Railgun network name from chain ID
 */
const getRailgunNetworkName = (chainId) => {
  const networkMap = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNBChain',
  };
  return networkMap[chainId] || `Chain${chainId}`;
};

/**
 * Format transaction history item for UI display
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

  // Determine transaction type and primary amounts
  let transactionType = 'Unknown';
  let primaryAmounts = [];
  let description = '';

  switch (category) {
    case 'ShieldERC20s':
      transactionType = 'Add to Vault';
      primaryAmounts = receiveERC20Amounts;
      description = 'Add tokens to vault';
      break;
    case 'UnshieldERC20s':
      transactionType = 'Remove from Vault';
      primaryAmounts = unshieldERC20Amounts;
      description = 'Remove tokens from vault';
      break;
    case 'TransferSendERC20s':
      transactionType = 'Send Transaction';
      primaryAmounts = transferERC20Amounts;
      description = 'Send transaction';
      break;
    case 'TransferReceiveERC20s':
      transactionType = 'Receive Transaction';
      primaryAmounts = receiveERC20Amounts;
      description = 'Receive transaction';
      break;
    default:
      transactionType = 'Unknown';
      primaryAmounts = [...transferERC20Amounts, ...receiveERC20Amounts, ...unshieldERC20Amounts];
      description = 'Unknown transaction type';
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

  // Determine if this is a private transfer
  const isPrivateTransfer = category === 'TransferSendERC20s' || category === 'TransferReceiveERC20s';

  // Initialize recipient/sender address and lexie id for private transfers
  let recipientAddress = null;
  let senderAddress = null;

  // Get memo and address information for private transfers
  if (isPrivateTransfer) {
    // For transfer transactions, memo and recipient address are in the first transferERC20Amounts item
    if (category === 'TransferSendERC20s' && transferERC20Amounts?.length > 0) {
      const transferAmount = transferERC20Amounts[0];
      if (transferAmount.recipientAddress) {
        recipientAddress = transferAmount.recipientAddress;
      }
    }
    // For receive transactions, memo and sender address are in the first receiveERC20Amounts item
    else if (category === 'TransferReceiveERC20s' && receiveERC20Amounts?.length > 0) {
      const receiveAmount = receiveERC20Amounts[0];
      if (receiveAmount.senderAddress) {
        senderAddress = receiveAmount.senderAddress;
      }
    }
  }

  // Copy function for transaction ID
  const copyTxId = async () => {
    try {
      await navigator.clipboard.writeText(txid);
      console.log('[TransactionHistory] ✅ Transaction ID copied to clipboard:', txid);
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
    memo: memo || null,
    isPrivateTransfer,
    recipientAddress,
    senderAddress,
    recipientLexieId: null, // Will be populated by RecipientSenderInfo component
    senderLexieId: null,    // Will be populated by RecipientSenderInfo component
    tokenAmounts,
    chainId,
    copyTxId,
    raw: {
      transferERC20Amounts,
      receiveERC20Amounts,
      unshieldERC20Amounts,
      changeERC20Amounts: historyItem.changeERC20Amounts || []
    }
  };
};

/**
 * Get token symbol for display
 */
const getTokenSymbol = (tokenAddress, chainId) => {
  if (!tokenAddress) return 'UNKNOWN';

  // Handle native token
  if (tokenAddress === '0x0000000000000000000000000000000000000000' ||
      tokenAddress === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    const nativeSymbols = { 1: 'ETH', 42161: 'ETH', 137: 'MATIC', 56: 'BNB' };
    return nativeSymbols[chainId] || 'ETH';
  }

  // Known tokens by network
  const knownTokens = {
    1: {
      '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
      '0x6b175474e89094c44da98b954eedeac495271d0f': 'DAI',
    },
    42161: {
      '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
      '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
    },
    56: {
      '0x55d398326f99059ff775485246999027b3197955': 'USDT',
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
    },
    137: {
      '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
      '0x2791bca1f2de4661ed88a30c99a7a9449aa84174': 'USDC',
    }
  };

  const chainTokens = knownTokens[chainId];
  if (chainTokens && chainTokens[tokenAddress.toLowerCase()]) {
    return chainTokens[tokenAddress.toLowerCase()];
  }

  return 'UNKNOWN';
};

/**
 * Get token decimals
 */
const getTokenDecimals = (tokenAddress, chainId) => {
  if (!tokenAddress) return 18;
  return 18; // Default for most tokens
};

/**
 * Format token amount for display
 */
const formatTokenAmount = (amount, decimals) => {
  try {
    if (!amount || amount === '0') return '0';
    const num = parseFloat(amount) / Math.pow(10, decimals);
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
 * Recipient/Sender Info Component for Private Transfers
 */
const RecipientSenderInfo = ({ transaction }) => {
  const [lexieId, setLexieId] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const lookupLexieId = async () => {
      if (!transaction || loading) return;

      // Use the recipient/sender address from the enhanced backend data
      let addressToLookup = null;
      if (transaction.type === 'transfer_send' && transaction.recipientAddress) {
        addressToLookup = transaction.recipientAddress;
      } else if (transaction.type === 'transfer_receive' && transaction.senderAddress) {
        addressToLookup = transaction.senderAddress;
      }

      if (!addressToLookup) {
        setLexieId(null);
        return;
      }

      // Check if we already have the Lexie ID from the backend
      if (transaction.recipientLexieId || transaction.senderLexieId) {
        setLexieId(transaction.recipientLexieId || transaction.senderLexieId);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(addressToLookup)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.lexieID) {
            setLexieId(data.lexieID);
          } else {
            setLexieId(null);
          }
        } else {
          setLexieId(null);
        }
      } catch (error) {
        console.warn('Failed to lookup Lexie ID:', error);
        setLexieId(null);
      } finally {
        setLoading(false);
      }
    };

    lookupLexieId();
  }, [transaction, loading]);

  if (loading) {
    return <span className="text-gray-400">Loading...</span>;
  }

  // Display based on transaction type
  if (transaction.type === 'transfer_send') {
    if (transaction.recipientAddress) {
      return (
        <div className="flex flex-col">
          <span className="text-blue-400/80 text-xs">To:</span>
          <span
            className="cursor-pointer hover:text-blue-200 transition-colors select-all text-xs"
            onClick={() => navigator.clipboard.writeText(lexieId || transaction.recipientAddress)}
            title={`Click to copy ${lexieId ? 'Lexie ID' : 'address'}`}
          >
            {lexieId ? (
              <span className="text-emerald-300 font-medium">{lexieId}</span>
            ) : (
              `${transaction.recipientAddress.slice(0, 8)}...${transaction.recipientAddress.slice(-6)}`
            )}
          </span>
        </div>
      );
    }
  } else if (transaction.type === 'transfer_receive') {
    if (transaction.senderAddress) {
      return (
        <div className="flex flex-col">
          <span className="text-green-400/80 text-xs">From:</span>
          <span
            className="cursor-pointer hover:text-green-200 transition-colors select-all text-xs"
            onClick={() => navigator.clipboard.writeText(lexieId || transaction.senderAddress)}
            title={`Click to copy ${lexieId ? 'Lexie ID' : 'address'}`}
          >
            {lexieId ? (
              <span className="text-emerald-300 font-medium">{lexieId}</span>
            ) : (
              `${transaction.senderAddress.slice(0, 8)}...${transaction.senderAddress.slice(-6)}`
            )}
          </span>
        </div>
      );
    }
  }

  return <span className="text-gray-500 text-xs">-</span>;
};

/**
 * Admin History Dashboard Component
 * Provides compliance and audit functionality for Railgun transactions using viewing keys
 */
const AdminHistoryPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [walletId, setWalletId] = useState(''); // This will store the view-only wallet ID for SDK calls
  const [originalWalletId, setOriginalWalletId] = useState(''); // For display purposes
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resolutionType, setResolutionType] = useState('');

  // RAILGUN engine and viewing keys state
  const [isRailgunInitialized, setIsRailgunInitialized] = useState(false);
  const [isInitializingRailgun, setIsInitializingRailgun] = useState(false);
  const [viewingKey, setViewingKey] = useState('');

  // Chain configuration for supported networks
  const supportedChains = [1, 42161, 137, 56]; // Ethereum, Arbitrum, Polygon, BNB Chain

  // Filtering state
  const [currentFilters, setCurrentFilters] = useState({
    types: ['shield', 'unshield', 'transfer_send', 'transfer_receive'],
    q: '',
    dateFrom: null,
    dateTo: null
  });

  // Initialize Railgun engine AFTER we have a walletId + viewing key
  const initializeRailgunEngine = useCallback(async () => {
    if (isRailgunInitialized) return;
    try {
      setIsInitializingRailgun(true);
      console.log('[AdminHistory] 🚀 Initializing Railgun engine...');

      const railgunWallet = await import('@railgun-community/wallet');
      const { startRailgunEngine, setLoggers } = railgunWallet;

      const LevelJS = (await import('level-js')).default;
      const db = new LevelJS('admin-railgun-db');

      const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
      const artifactManager = await createEnhancedArtifactStore(false);

      setLoggers(
        (message) => console.log(`🔍 [RAILGUN-SDK] ${message}`),
        (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
      );

      await startRailgunEngine(
        'lexie-admin',
        db,
        true,
        artifactManager.store,
        false,
        false,
        [],
        [],
        true
      );

      setIsRailgunInitialized(true);
      console.log('[AdminHistory] ✅ Railgun engine ready.');
    } catch (error) {
      console.error('[AdminHistory] ❌ Failed to initialize Railgun engine:', error);
      throw error;
    } finally {
      setIsInitializingRailgun(false);
    }
  }, [isRailgunInitialized]);

  // Note: Admin authentication is handled by backend HMAC + role verification
  // Frontend will rely on backend to enforce admin access control

  // Note: HMAC authentication is handled by the /api/admin proxy
  // The proxy generates proper HMAC headers and forwards to backend

  /**
   * Create a view-only wallet using the viewing key from Redis
   * Uses Node.js crypto pbkdf2 for encryption key generation
   */
  const createViewOnlyWallet = useCallback(async (viewingKey) => {
    try {
      console.log('[AdminHistory] 🔑 Creating view-only wallet with viewing key:', {
        viewingKeyPrefix: viewingKey?.slice(0, 8) + '...'
      });

      // Import Railgun SDK dynamically
      const railgunWallet = await import('@railgun-community/wallet');
      const { createViewOnlyRailgunWallet } = railgunWallet;

      // Import Node.js crypto for key derivation
      const crypto = await import('crypto');

      // Generate a unique local encryption key using Node.js crypto pbkdf2
      // This is just for local storage encryption, NOT for spending
      const password = `admin-view-${Date.now()}-${Math.random()}`;
      const salt = 'lexie-admin-view-only-v1'; // Stable salt for admin view-only wallets

      // Use Node.js crypto pbkdf2 function
      // Parameters: password, salt, iterations, keyLength, digest
      const encryptionKey = crypto.pbkdf2Sync(
        password,
        salt,
        100000,  // iterations (Railgun recommended)
        32,      // key length in bytes
        'sha256' // digest algorithm
      ).toString('hex');

      console.log('[AdminHistory] Generated encryption key using Node.js crypto pbkdf2');

      // Create view-only wallet
      const viewOnlyWalletInfo = await createViewOnlyRailgunWallet(
        encryptionKey,
        viewingKey,
        undefined // creationBlockNumberMap
      );

      if (!viewOnlyWalletInfo?.id || !viewOnlyWalletInfo?.railgunAddress) {
        throw new Error(`Failed to create view-only wallet: ${JSON.stringify(viewOnlyWalletInfo)}`);
      }

      console.log('[AdminHistory] ✅ View-only wallet created successfully:', {
        viewOnlyWalletId: viewOnlyWalletInfo.id.slice(0, 8) + '...',
        railgunAddress: viewOnlyWalletInfo.railgunAddress.slice(0, 8) + '...',
        note: 'This is a NEW wallet ID, different from the original!'
      });

      // Store the view-only wallet info for reference
      window.__ADMIN_VIEW_ONLY_WALLET__ = {
        id: viewOnlyWalletInfo.id,
        railgunAddress: viewOnlyWalletInfo.railgunAddress,
        createdAt: Date.now()
      };

      return viewOnlyWalletInfo;
    } catch (error) {
      console.error('[AdminHistory] ❌ Failed to create view-only wallet:', error);
      throw error;
    }
  }, []);

  /**
   * Initialize wallet with viewing key for transaction access using API
   * Creates a new view-only wallet locally and returns the viewOnlyWalletId
   */
  const initializeWalletWithViewingKey = useCallback(async (walletId, walletAddress, railgunAddress) => {
    try {
      console.log('[AdminHistory] Retrieving existing viewing key for wallet:', {
        walletId: walletId?.slice(0, 8) + '...',
        walletAddress: walletAddress?.slice(0, 8) + '...',
        railgunAddress: railgunAddress?.slice(0, 8) + '...'
      });

      // Retrieve existing viewing key
      const getResponse = await fetch(`/api/wallet-metadata?action=viewing-key-get&walletId=${walletId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!getResponse.ok) {
        const errorText = await getResponse.text();
        console.error('[AdminHistory] ❌ Failed to retrieve viewing key - API error:', {
          status: getResponse.status,
          statusText: getResponse.statusText,
          response: errorText
        });
        throw new Error(`API request failed: ${getResponse.status} ${getResponse.statusText}`);
      }

      const getData = await getResponse.json();

      if (!getData.success) {
        console.error('[AdminHistory] ❌ Viewing key not found for walletId=' + walletId?.slice(0, 8) + '.... This should have been created at wallet creation.');
        setError(`No viewing key found for this wallet. This wallet may not have been properly initialized during onboarding.`);
        throw new Error('Viewing key not found - this wallet may not have been properly initialized');
      }

      if (!getData.viewingKey) {
        console.error('[AdminHistory] ❌ Empty viewing key returned for walletId=' + walletId?.slice(0, 8) + '.... This indicates a data integrity issue.');
        setError(`Viewing key data is corrupted. Please contact support.`);
        throw new Error('Viewing key data is corrupted');
      }

      setViewingKey(getData.viewingKey);

      console.log('[AdminHistory] ✅ Successfully retrieved viewing key for wallet:', {
        walletId: walletId?.slice(0, 8) + '...',
        viewingKeyPrefix: getData.viewingKey?.slice(0, 8) + '...'
      });

      // Initialize engine now that we have a viewing key
      await initializeRailgunEngine();

      // Create view-only wallet using the viewing key (ignore original walletId)
      const viewOnlyWalletInfo = await createViewOnlyWallet(getData.viewingKey);
      const viewOnlyWalletId = viewOnlyWalletInfo.id;

      // Fetch history using the new view-only wallet ID
      await fetchTransactionHistory(viewOnlyWalletId);

      return {
        viewingKey: getData.viewingKey,
        viewOnlyWalletId: viewOnlyWalletId
      };
    } catch (error) {
      console.error('[AdminHistory] ❌ Failed to retrieve viewing key for walletId=' + walletId?.slice(0, 8) + '...:', error);
      setError(`Failed to retrieve viewing key: ${error.message}`);
      throw error;
    }
  }, [initializeRailgunEngine, createViewOnlyWallet, fetchTransactionHistory]);

  /**
   * Process search query and get wallet data/transaction history using viewing keys
   */
  const processQuery = useCallback(async (query) => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');

    try {
      console.log('[AdminHistory] Processing query:', query);

      // Check what type of input this is
      if (query.startsWith('0zk')) {
        // Direct Railgun address - resolve to walletId using backend
        console.log('[AdminHistory] Detected Railgun address, resolving to walletId...');

        const response = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          setOriginalWalletId(data.walletId);
          setResolutionType(data.resolutionType);
          console.log('[AdminHistory] Railgun address resolved:', {
            railgunAddress: query.slice(0, 10) + '...',
            walletId: data.walletId?.slice(0, 10) + '...',
            resolutionType: data.resolutionType
          });

          // Initialize wallet with viewing key → engine → create view-only wallet → fetch history
          const result = await initializeWalletWithViewingKey(data.walletId, '', query);
          setWalletId(result.viewOnlyWalletId); // Store the view-only wallet ID for SDK calls
        } else {
          setError(data.error || 'Failed to resolve Railgun address');
        }

      } else if (query.startsWith('0x') && query.length === 66) {
        // Transaction hash - resolve to wallet and initialize with viewing key
        const response = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          setOriginalWalletId(data.walletId);
          setResolutionType(data.resolutionType);
          console.log('[AdminHistory] Transaction hash resolved:', {
            query,
            walletId: data.walletId,
            resolutionType: data.resolutionType
          });

          // Initialize wallet with viewing key → engine → create view-only wallet → fetch history
          const result = await initializeWalletWithViewingKey(data.walletId, '', '');
          setWalletId(result.viewOnlyWalletId); // Store the view-only wallet ID for SDK calls
        } else {
          setError(data.error || 'Failed to resolve transaction hash');
        }

      } else if (query.startsWith('0x') && query.length === 42) {
        // EOA address - get wallet metadata and initialize with viewing key
        console.log('[AdminHistory] Detected EOA address, getting wallet metadata...');

        const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.keys && data.keys.length > 0) {
          const walletInfo = data.keys[0]; // Get first wallet
          setOriginalWalletId(walletInfo.walletId);
          setResolutionType('eoa');

          console.log('[AdminHistory] EOA resolved to wallet:', {
            eoa: query,
            railgunAddress: walletInfo.railgunAddress?.slice(0, 10) + '...',
            walletId: walletInfo.walletId?.slice(0, 10) + '...',
            scannedChains: walletInfo.scannedChains
          });

          // Initialize wallet with viewing key → engine → create view-only wallet → fetch history
          const result = await initializeWalletWithViewingKey(
            walletInfo.walletId,
            query,
            walletInfo.railgunAddress
          );
          setWalletId(result.viewOnlyWalletId); // Store the view-only wallet ID for SDK calls
        } else {
          setError('No wallet found for this EOA address');
        }

      } else {
        setError('Invalid input format. Please enter an EOA address (0x...), transaction hash, or Railgun address (0zk...)');
      }

    } catch (err) {
      console.error('[AdminHistory] Query processing failed:', err);
      setError(`Failed to process query: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [initializeWalletWithViewingKey]);

  /**
   * Fetch transaction history via shared utility across all chains using viewOnlyWalletId
   */
  const fetchTransactionHistory = useCallback(async (viewOnlyWalletId) => {
    if (!isRailgunInitialized) return;

    setLoading(true);
    setError('');

    try {
      const allTransactions = [];
      for (const chainId of supportedChains) {
        try {
          const chainTxs = await getTransactionHistory(viewOnlyWalletId, chainId);
          const withChain = chainTxs.map(tx => ({
            ...tx,
            chainId,
            chainName: getChainName(chainId)
          }));
          allTransactions.push(...withChain);
        } catch (chainError) {
          console.warn(`[AdminHistory] ⚠️ History fetch failed for chain ${chainId}:`, chainError?.message);
        }
      }

      allTransactions.sort((a, b) => {
        if (!a.timestamp && !b.timestamp) return 0;
        if (!a.timestamp) return 1;
        if (!b.timestamp) return -1;
        return b.timestamp - a.timestamp;
      });

      setTransactionHistory(allTransactions);
      console.log(`[AdminHistory] 📊 History fetched from SDK for viewOnlyWalletId=${viewOnlyWalletId.slice(0, 8)}... (${allTransactions.length} transactions).`);
    } catch (err) {
      console.error('[AdminHistory] ❌ Fetch failed:', err);
      setError(`Failed to fetch transaction history: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [isRailgunInitialized, supportedChains]);

  /**
   * Export transaction history as JSON using RAILGUN SDK data
   */
  const exportJSON = useCallback(async () => {
    if (!originalWalletId || !transactionHistory.length) return;

    try {
      console.log('[AdminHistory] Exporting JSON for wallet:', originalWalletId, 'using RAILGUN SDK data');

      const jsonData = {
        originalWalletId,
        viewOnlyWalletId: walletId,
        exportDate: new Date().toISOString(),
        resolutionType,
        totalTransactions: transactionHistory.length,
        chains: supportedChains,
        filters: currentFilters,
        transactions: transactionHistory,
        exportMethod: 'railgun-sdk-direct'
      };

      const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-${originalWalletId.slice(0, 8)}-railgun-history.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('[AdminHistory] RAILGUN SDK JSON export completed', {
        totalTransactions: transactionHistory.length
      });

      toast.success('Transaction history exported successfully');
    } catch (err) {
      console.error('[AdminHistory] RAILGUN SDK JSON export failed:', err);
      setError(`Export failed: ${err.message}`);
      toast.error('Export failed');
    }
  }, [originalWalletId, walletId, transactionHistory, resolutionType, supportedChains, currentFilters]);

  /**
   * Handle filter changes and refresh data
   */
  const handleFiltersChange = useCallback((newFilters) => {
    setCurrentFilters(newFilters);
    if (walletId) {
      fetchTransactionHistory(walletId); // Re-fetch with new filters using viewOnlyWalletId
    }
  }, [walletId, fetchTransactionHistory]);

  /**
   * Handle search query changes
   */
  const handleSearchChange = useCallback((query) => {
    const newFilters = { ...currentFilters, q: query };
    handleFiltersChange(newFilters);
  }, [currentFilters, handleFiltersChange]);

  /**
   * Format transaction amount for display
   */
  const formatAmount = (amount, decimals = 18) => {
    try {
      return formatUnits(amount || '0', decimals);
    } catch (err) {
      return '0';
    }
  };

  /**
   * Get transaction type display name
   */
  const getTransactionType = (type) => {
    const typeMap = {
      shield: 'Add to Vault',
      unshield: 'Remove from Vault',
      transfer_send: 'Send Transfer',
      transfer_receive: 'Receive Transfer'
    };
    return typeMap[type] || type;
  };

  /**
   * Get chain name for display
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
   * Handle search form submission
   */
  const handleSearch = (e) => {
    e.preventDefault();
    processQuery(searchQuery);
  };

  /**
   * Copy transaction ID to clipboard
   */
  const copyTxId = async (txId) => {
    try {
      await navigator.clipboard.writeText(txId);
      console.log('[AdminHistory] Transaction ID copied:', txId);
      toast.success('Transaction ID copied to clipboard');
    } catch (err) {
      console.error('[AdminHistory] Failed to copy transaction ID:', err);
      toast.error('Failed to copy transaction ID');
    }
  };

  return (
    <div className="admin-history-container">
      <div className="admin-header">
        <h1>Railgun Wallet Inspector</h1>
        <p>Search by transaction hash, Railgun address, or EOA address for compliance and audit using Railgun SDK</p>
        {isInitializingRailgun && (
          <div className="text-center mt-4">
            <div className="inline-flex items-center gap-2 text-blue-400">
              <div className="h-4 w-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              Initializing Railgun engine...
            </div>
          </div>
        )}
        {isRailgunInitialized && !isInitializingRailgun && (
          <div className="text-center mt-4 text-green-400 text-sm">
            ✅ Railgun engine ready - Ready to load view-only wallets and fetch transaction history
          </div>
        )}
      </div>

      <div className="search-section">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter transaction hash, 0zk address, or EOA address"
            className="search-input"
            disabled={loading || isInitializingRailgun || !isRailgunInitialized}
          />
          <button
            type="submit"
            className="search-button"
            disabled={loading || isInitializingRailgun || !isRailgunInitialized}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {originalWalletId && (
          <div className="wallet-info">
            <h3>Wallet Information</h3>
            <p><strong>Original Wallet ID:</strong> {originalWalletId.slice(0, 8)}...{originalWalletId.slice(-6)}</p>
            <p><strong>View-Only Wallet ID:</strong> {walletId.slice(0, 8)}...{walletId.slice(-6)}</p>
            <p><strong>Resolution Type:</strong> {resolutionType}</p>
            <p><strong>Viewing Key:</strong> {viewingKey ? `${viewingKey.slice(0, 8)}...${viewingKey.slice(-6)}` : 'Not generated'}</p>
            <div className="export-buttons">
              <button onClick={exportJSON} className="export-btn json-btn">
                Export JSON
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filters Section */}
      {originalWalletId && transactionHistory.length > 0 && (
        <div className="filters-section">
          <h3>Filters</h3>
          <div className="filters-grid">
            {/* Type Filter */}
            <div className="filter-group">
              <label>Transaction Types:</label>
              <div className="type-checkboxes">
                {[
                  { value: 'shield', label: 'Add to Vault' },
                  { value: 'unshield', label: 'Remove from Vault' },
                  { value: 'transfer_send', label: 'Send Transfer' },
                  { value: 'transfer_receive', label: 'Receive Transfer' }
                ].map(type => (
                  <label key={type.value} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={currentFilters.types.includes(type.value)}
                      onChange={(e) => {
                        const newTypes = e.target.checked
                          ? [...currentFilters.types, type.value]
                          : currentFilters.types.filter(t => t !== type.value);
                        handleFiltersChange({ ...currentFilters, types: newTypes });
                      }}
                    />
                    {type.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Search Filter */}
            <div className="filter-group">
              <label>Search:</label>
              <input
                type="text"
                placeholder="Token, memo, tx hash, or address..."
                value={currentFilters.q}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="search-filter-input"
              />
            </div>

            {/* Date Range Filter */}
            <div className="filter-group">
              <label>Date Range:</label>
              <div className="date-inputs">
                <input
                  type="date"
                  value={currentFilters.dateFrom || ''}
                  onChange={(e) => handleFiltersChange({
                    ...currentFilters,
                    dateFrom: e.target.value || null
                  })}
                  placeholder="From"
                />
                <span>to</span>
                <input
                  type="date"
                  value={currentFilters.dateTo || ''}
                  onChange={(e) => handleFiltersChange({
                    ...currentFilters,
                    dateTo: e.target.value || null
                  })}
                  placeholder="To"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      {/* Transaction History Section - Only show this */}
      {transactionHistory.length > 0 && (
        <div className="history-section">
          <h3>Transaction History ({transactionHistory.length} transactions)</h3>
          <div className="transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Chain</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Token</th>
                  <th>Amount</th>
                  <th>Transaction Hash</th>
                  <th>0zk Address</th>
                  <th>Recipient/Sender</th>
                  <th>Memo</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactionHistory.map((tx, index) => (
                  <tr key={`${tx.txid || tx.traceId || tx.id || index}`}>
                    <td>
                      {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'Unknown'}
                    </td>
                    <td>{tx.chainName || getChainName(tx.chainId)}</td>
                    <td>{getTransactionType(tx.category || tx.type)}</td>
                    <td>
                      <span className={`status-${tx.status || 'mined'}`}>
                        {tx.status || 'Mined'}
                      </span>
                    </td>
                    <td>
                      {tx.tokenAmounts && tx.tokenAmounts.length > 0
                        ? tx.tokenAmounts[0].symbol || 'Unknown'
                        : 'Unknown'
                      }
                    </td>
                    <td>
                      {tx.tokenAmounts && tx.tokenAmounts.length > 0
                        ? tx.tokenAmounts[0].formattedAmount || formatAmount(tx.tokenAmounts[0].amount)
                        : '0'
                      }
                    </td>
                    <td>
                      {tx.txid ? (
                        <span
                          className="clickable-hash"
                          onClick={() => copyTxId(tx.txid)}
                          title="Click to copy transaction hash"
                        >
                          {tx.txid.slice(0, 8)}...{tx.txid.slice(-6)}
                        </span>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td>
                      {tx.zkAddr ? (
                        <span
                          className="clickable-hash"
                          onClick={() => copyTxId(tx.zkAddr)}
                          title="Click to copy Railgun address"
                        >
                          {tx.zkAddr.slice(0, 8)}...{tx.zkAddr.slice(-6)}
                        </span>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td>
                      {(tx.category === 'transfer_send' || tx.category === 'transfer_receive') ? (
                        <RecipientSenderInfo transaction={tx} />
                      ) : (
                        <span className="text-gray-500">-</span>
                      )}
                    </td>
                    <td>
                      {tx.memo ? (
                        <span title={tx.memo}>
                          {tx.memo.length > 20 ? `${tx.memo.slice(0, 20)}...` : tx.memo}
                        </span>
                      ) : (
                        'No memo'
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => copyTxId(tx.txid || tx.traceId || tx.id)}
                        className="action-btn"
                      >
                        Copy ID
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!walletId && !loading && !error && !isInitializingRailgun && (
        <div className="empty-state">
          <h3>No Search Performed</h3>
          <p>Enter a transaction hash, Railgun address (0zk...), or EOA address (0x...) to view wallet transaction history using the Railgun SDK.</p>
        </div>
      )}

    </div>
  );
};

export default AdminHistoryPage;
