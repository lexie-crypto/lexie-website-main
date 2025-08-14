/**
 * TransactionHistory Component
 * Displays RAILGUN private transaction history with filtering and search
 */

import React, { useState } from 'react';
import useTransactionHistory from '../hooks/useTransactionHistory';
import { TransactionCategory } from '../utils/railgun/transactionHistory';

const TransactionHistory = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDetails, setShowDetails] = useState({});

  const {
    transactions,
    loading,
    error,
    lastUpdated,
    refreshHistory,
    getTransactionsByType,
    searchTransactions,
    statistics,
    hasTransactions,
    isEmpty
  } = useTransactionHistory({ autoLoad: true, limit: 100 });

  // Get filtered transactions
  const getDisplayTransactions = () => {
    let filtered = getTransactionsByType(selectedCategory);
    
    if (searchQuery.trim()) {
      filtered = searchTransactions(searchQuery);
    }
    
    return filtered;
  };

  const displayTransactions = getDisplayTransactions();

  // Toggle transaction details
  const toggleDetails = (txid) => {
    setShowDetails(prev => ({
      ...prev,
      [txid]: !prev[txid]
    }));
  };

  // Format transaction type for display
  const getTransactionIcon = (type) => {
    switch (type) {
      case 'Shield':
        return '🛡️';
      case 'Unshield':
        return '🔓';
      case 'Private Send':
        return '📤';
      case 'Private Receive':
        return '📥';
      default:
        return '❓';
    }
  };

  // Get status color
  const getStatusColor = (type) => {
    switch (type) {
      case 'Shield':
        return 'text-green-400';
      case 'Unshield':
        return 'text-blue-400';
      case 'Private Send':
        return 'text-red-400';
      case 'Private Receive':
        return 'text-green-400';
      default:
        return 'text-gray-400';
    }
  };

  if (loading && !hasTransactions) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
          <span className="ml-3 text-gray-400">Loading transaction history...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="text-center py-8">
          <div className="text-red-400 mb-4">⚠️ Failed to load transaction history</div>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={refreshHistory}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-semibold text-white flex items-center">
            🕐 Transaction History
          </h3>
          <p className="text-gray-400 text-sm mt-1">
            {statistics.total} total transactions
            {lastUpdated && ` • Updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={refreshHistory}
          disabled={loading}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-4 mb-4">
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-purple-500 focus:outline-none"
          >
            <option value="all">All Transactions ({statistics.total})</option>
            <option value="shield">Shields ({statistics.shields})</option>
            <option value="unshield">Unshields ({statistics.unshields})</option>
            <option value="transfers">Private Transfers ({statistics.privateTransfers})</option>
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search by token, type, or TX ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-purple-500 focus:outline-none flex-1 min-w-64"
          />
        </div>
      </div>

      {/* Transaction List */}
      {isEmpty ? (
        <div className="text-center py-8">
          <div className="text-gray-400 mb-4">📋 No transactions found</div>
          <p className="text-gray-500">
            Start using RAILGUN privacy features to see your transaction history here.
          </p>
        </div>
      ) : displayTransactions.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-gray-400 mb-4">🔍 No transactions match your search</div>
          <p className="text-gray-500">
            Try adjusting your search query or filter criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayTransactions.map((tx) => (
            <div
              key={tx.txid}
              className="bg-gray-700 rounded-lg p-4 hover:bg-gray-650 transition-colors"
            >
              {/* Transaction Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{getTransactionIcon(tx.transactionType)}</span>
                  <div>
                    <div className={`font-medium ${getStatusColor(tx.transactionType)}`}>
                      {tx.transactionType}
                    </div>
                    <div className="text-gray-400 text-sm">
                      {tx.date ? tx.date.toLocaleString() : 'Unknown time'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => toggleDetails(tx.txid)}
                  className="text-purple-400 hover:text-purple-300 text-sm"
                >
                  {showDetails[tx.txid] ? 'Hide Details' : 'Show Details'}
                </button>
              </div>

              {/* Token Amounts */}
              <div className="mb-3">
                {tx.tokenAmounts.map((token, index) => (
                  <div key={index} className="flex items-center justify-between py-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-white font-medium">{token.symbol}</span>
                      <span className="text-gray-400 text-sm">
                        {token.tokenAddress ? 
                          `${token.tokenAddress.slice(0, 6)}...${token.tokenAddress.slice(-4)}` : 
                          'Native'
                        }
                      </span>
                    </div>
                    <div className="text-white font-medium">
                      {token.formattedAmount}
                    </div>
                  </div>
                ))}
              </div>

              {/* Description + Memo */}
              <div className="text-gray-400 text-sm mb-3">
                <div>{tx.description}</div>
                {tx.memo && (
                  <div className="mt-1 text-blue-300 break-words">
                    Memo: {tx.memo}
                  </div>
                )}
              </div>

              {/* Details */}
              {showDetails[tx.txid] && (
                <div className="border-t border-gray-600 pt-3 mt-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-400">Transaction ID:</span>
                      <div className="text-white font-mono break-all">
                        {tx.txid}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">Block Number:</span>
                      <div className="text-white">
                        {tx.blockNumber || 'Unknown'}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">Category:</span>
                      <div className="text-white">
                        {tx.category}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">Chain ID:</span>
                      <div className="text-white">
                        {tx.chainId}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load More Button (if needed) */}
      {displayTransactions.length >= 100 && (
        <div className="text-center mt-6">
          <button
            onClick={() => {/* Implement load more */}}
            className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Load More Transactions
          </button>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory; 