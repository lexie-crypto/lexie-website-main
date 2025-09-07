/**
 * useTransactionHistory Hook
 * Manages RAILGUN private transaction history with loading states and filtering
 */

import { useState, useEffect, useCallback } from 'react';
import { useWallet } from '../contexts/WalletContext';
import {
  getTransactionHistory,
  getRecentTransactionHistory,
  getShieldTransactions,
  getUnshieldTransactions,
  getPrivateTransfers,
  TransactionCategory
} from '../utils/railgun/transactionHistory';

/**
 * Hook for managing RAILGUN transaction history
 * @param {Object} options - Configuration options
 * @param {boolean} options.autoLoad - Whether to auto-load on mount (default: true)
 * @param {number} options.limit - Maximum number of transactions to load (default: 50)
 * @param {string} options.category - Filter by transaction category
 * @returns {Object} Transaction history state and functions
 */
const useTransactionHistory = ({ 
  autoLoad = true, 
  limit = 50, 
  category = null 
} = {}) => {
  const { chainId, railgunWalletId } = useWallet();
  
  // State management
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Filtered transaction states
  const [shieldTransactions, setShieldTransactions] = useState([]);
  const [unshieldTransactions, setUnshieldTransactions] = useState([]);
  const [privateTransfers, setPrivateTransfers] = useState([]);

  /**
   * Load transaction history
   */
  const loadTransactionHistory = useCallback(async () => {
    if (!railgunWalletId || !chainId) {
      console.log('[useTransactionHistory] Missing wallet or chain ID');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('[useTransactionHistory] Loading transaction history:', {
        walletID: railgunWalletId?.slice(0, 8) + '...',
        chainId,
        category,
        limit
      });

      let history = [];

      // Load based on category filter
      if (category) {
        switch (category) {
          case TransactionCategory.SHIELD:
            history = await getShieldTransactions(railgunWalletId, chainId);
            break;
          case TransactionCategory.UNSHIELD:
            history = await getUnshieldTransactions(railgunWalletId, chainId);
            break;
          case 'TRANSFERS':
            history = await getPrivateTransfers(railgunWalletId, chainId);
            break;
          default:
            history = await getTransactionHistory(railgunWalletId, chainId);
        }
      } else if (limit && limit <= 50) {
        // Use recent history for performance
        history = await getRecentTransactionHistory(railgunWalletId, chainId);
      } else {
        // Load full history
        history = await getTransactionHistory(railgunWalletId, chainId);
      }

      // Apply limit if specified
      if (limit && history.length > limit) {
        history = history.slice(0, limit);
      }

      setTransactions(history);
      setLastUpdated(new Date());

      // Separate by category for quick access
      const shields = history.filter(tx => tx.category === TransactionCategory.SHIELD);
      const unshields = history.filter(tx => tx.category === TransactionCategory.UNSHIELD);
      const transfers = history.filter(tx => 
        tx.category === TransactionCategory.TRANSFER_SEND || 
        tx.category === TransactionCategory.TRANSFER_RECEIVE
      );

      setShieldTransactions(shields);
      setUnshieldTransactions(unshields);
      setPrivateTransfers(transfers);

      console.log('[useTransactionHistory] ✅ Transaction history loaded:', {
        total: history.length,
        shields: shields.length,
        unshields: unshields.length,
        transfers: transfers.length,
        dateRange: history.length > 0 ? {
          latest: history[0]?.date?.toLocaleString(),
          earliest: history[history.length - 1]?.date?.toLocaleString()
        } : null
      });

    } catch (err) {
      console.error('[useTransactionHistory] Failed to load transaction history:', err);
      setError(err.message || 'Failed to load transaction history');
      setTransactions([]);
      setShieldTransactions([]);
      setUnshieldTransactions([]);
      setPrivateTransfers([]);
    } finally {
      setLoading(false);
    }
  }, [railgunWalletId, chainId, category, limit]);

  /**
   * Refresh transaction history
   */
  const refreshHistory = useCallback(async () => {
    console.log('[useTransactionHistory] 🔄 Refreshing transaction history...');
    await loadTransactionHistory();
  }, [loadTransactionHistory]);

  // Listen for global refresh events
  useEffect(() => {
    const handleRefreshEvent = () => {
      console.log('[useTransactionHistory] 📡 Received global refresh event');
      refreshHistory();
    };

    window.addEventListener('transaction-history-refresh', handleRefreshEvent);

    return () => {
      window.removeEventListener('transaction-history-refresh', handleRefreshEvent);
    };
  }, [refreshHistory]);

  /**
   * Get transactions by type
   */
  const getTransactionsByType = useCallback((type) => {
    switch (type) {
      case 'shield':
      case TransactionCategory.SHIELD:
        return shieldTransactions;
      case 'unshield':
      case TransactionCategory.UNSHIELD:
        return unshieldTransactions;
      case 'transfers':
      case 'private':
        return privateTransfers;
      case 'all':
      default:
        return transactions;
    }
  }, [transactions, shieldTransactions, unshieldTransactions, privateTransfers]);

  /**
   * Search transactions by token symbol or address
   */
  const searchTransactions = useCallback((query) => {
    if (!query || query.trim() === '') {
      return transactions;
    }

    const queryLower = query.toLowerCase();
    return transactions.filter(tx => {
      // Search in token amounts
      return tx.tokenAmounts.some(token => 
        token.symbol.toLowerCase().includes(queryLower) ||
        token.tokenAddress?.toLowerCase().includes(queryLower)
      ) ||
      // Search in transaction type
      tx.transactionType.toLowerCase().includes(queryLower) ||
      // Search in description
      tx.description.toLowerCase().includes(queryLower) ||
      // Search in transaction ID (partial)
      tx.txid.toLowerCase().includes(queryLower);
    });
  }, [transactions]);

  /**
   * Get transaction statistics
   */
  const getStatistics = useCallback(() => {
    return {
      total: transactions.length,
      shields: shieldTransactions.length,
      unshields: unshieldTransactions.length,
      privateTransfers: privateTransfers.length,
      unknown: transactions.filter(tx => tx.category === TransactionCategory.UNKNOWN).length,
      lastUpdated
    };
  }, [transactions, shieldTransactions, unshieldTransactions, privateTransfers, lastUpdated]);

  /**
   * Auto-load on mount and wallet/chain changes
   */
  useEffect(() => {
    if (autoLoad && railgunWalletId && chainId) {
      console.log('[useTransactionHistory] 🚀 Auto-loading transaction history on mount...');
      loadTransactionHistory();
    }
  }, [autoLoad, railgunWalletId, chainId, loadTransactionHistory]);

  /**
   * Listen for new transactions (future enhancement)
   * Could listen to balance update events as proxy for new transactions
   */
  useEffect(() => {
    const handleBalanceUpdate = () => {
      // When balances update, there might be new transactions
      // Refresh history after a short delay to allow for network sync
      setTimeout(() => {
        if (railgunWalletId && chainId) {
          console.log('[useTransactionHistory] 🔄 Refreshing history after balance update...');
          refreshHistory();
        }
      }, 5000); // Wait 5 seconds for network sync
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('railgun-balance-update', handleBalanceUpdate);
      return () => {
        window.removeEventListener('railgun-balance-update', handleBalanceUpdate);
      };
    }
  }, [railgunWalletId, chainId, refreshHistory]);

  return {
    // Main data
    transactions,
    loading,
    error,
    lastUpdated,

    // Categorized data
    shieldTransactions,
    unshieldTransactions,
    privateTransfers,

    // Functions
    loadTransactionHistory,
    refreshHistory,
    getTransactionsByType,
    searchTransactions,
    getStatistics,

    // Computed values
    hasTransactions: transactions.length > 0,
    isEmpty: !loading && transactions.length === 0,
    statistics: getStatistics()
  };
};

export default useTransactionHistory; 