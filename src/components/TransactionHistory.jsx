/**
 * TransactionHistory Component
 * Displays RAILGUN private transaction history with filtering and search
 */

import React, { useState } from 'react';
import useTransactionHistory from '../hooks/useTransactionHistory';
import { TransactionCategory } from '../utils/railgun/transactionHistory';
import { useWallet } from '../contexts/WalletContext';

const TransactionHistory = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Debug wallet context values
  const { chainId, railgunWalletId, isRailgunInitialized, canUseRailgun } = useWallet();
  
  React.useEffect(() => {
    console.log('[TransactionHistory] Wallet context debug:', {
      chainId,
      hasRailgunWalletId: !!railgunWalletId,
      railgunWalletId: railgunWalletId?.slice(0, 8) + '...' || 'null',
      isRailgunInitialized,
      canUseRailgun,
      userAgent: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    });
  }, [chainId, railgunWalletId, isRailgunInitialized, canUseRailgun]);

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

  // Get block explorer URL for transaction
  const getBlockExplorerUrl = (chainId, txid) => {
    const explorers = {
      1: 'https://etherscan.io/tx/', // Ethereum
      42161: 'https://arbiscan.io/tx/', // Arbitrum
      137: 'https://polygonscan.com/tx/', // Polygon
      56: 'https://bscscan.com/tx/' // BNB Chain
    };
    return explorers[chainId] ? `${explorers[chainId]}${txid}` : null;
  };

  // Format transaction type for display
  const getTransactionIcon = (type) => {
    switch (type) {
      case 'Add to Vault':
        return '+';
      case 'Remove from Vault':
        return '-';
      case 'Send Transaction':
        return '>>>';
      case 'Receive Transaction':
        return '<<<';
      default:
        return '[?]';
    }
  };

  // Get status color
  const getStatusColor = (type) => {
    switch (type) {
      case 'Add to Vault':
        return 'text-green-400';
      case 'Remove from Vault':
        return 'text-green-400';
      case 'Send Transaction':
        return 'text-green-400';
      case 'Receive Transaction':
        return 'text-green-400';
      default:
        return 'text-green-400';
    }
  };

  if (loading && !hasTransactions) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          <span className="ml-3 text-green-400/80">Loading transaction history...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="text-center py-8">
          <div className="text-red-300 mb-4">⚠️ Failed to load transaction history</div>
          <p className="text-green-400/80 mb-4">{error}</p>
          <button
            onClick={refreshHistory}
            className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded border border-emerald-400/40 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 border border-green-500/20 rounded p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-3">
        <div>
          <h3 className="text-xl font-semibold text-emerald-300 flex items-center">
            Transaction History
          </h3>
          <p className="text-green-400/80 text-sm mt-1">
            {statistics.total} total transactions
            {lastUpdated && ` • Updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={refreshHistory}
          disabled={loading}
          className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded border border-emerald-400/40 transition-colors disabled:opacity-50 self-start sm:self-auto"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-black text-green-300 rounded px-3 py-2 border border-green-500/40 focus:border-emerald-400 focus:outline-none w-full sm:w-auto"
          >
            <option value="all">All Transactions ({statistics.total})</option>
            <option value="shield">Add to Vault ({statistics.shields})</option>
            <option value="unshield">Remove from Vault ({statistics.unshields})</option>
            <option value="transfers">Send Transaction ({statistics.privateTransfers})</option>
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search by token, type, or TX ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-black text-green-200 rounded px-3 py-2 border border-green-500/40 focus:border-emerald-400 focus:outline-none flex-1"
          />
        </div>
      </div>

      {/* Transaction List */}
      {isEmpty ? (
        <div className="text-center py-8">
          <div className="text-green-400/70 mb-4">No transactions found</div>
          <p className="text-green-400/60">
            Start using vault features to see your transaction history here.
          </p>
        </div>
      ) : displayTransactions.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-green-400/70 mb-4">🔍 No transactions match your search</div>
          <p className="text-green-400/60">
            Try adjusting your search query or filter criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayTransactions.map((tx) => (
            <div
              key={tx.txid}
              className="bg-black/60 border border-green-500/20 rounded p-4 hover:bg-black/80 transition-colors"
            >
              {/* Transaction Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{getTransactionIcon(tx.transactionType)}</span>
                  <div>
                    <div className={`font-medium ${getStatusColor(tx.transactionType)}`}>
                      {tx.transactionType}
                    </div>
                    <div className="text-green-400/70 text-sm">
                      {tx.date ? tx.date.toLocaleString() : 'Unknown time'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Token Amounts */}
              <div className="mb-3">
                {tx.tokenAmounts.map((token, index) => (
                  <div key={index} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-1 gap-1">
                    <div className="flex items-center space-x-2 min-w-0">
                      <span className="text-green-200 font-medium">{token.symbol}</span>
                      {/* Token address hidden for cleaner display */}
                    </div>
                    <div className="text-green-200 font-medium text-right">
                      {token.formattedAmount}
                    </div>
                  </div>
                ))}
              </div>

              {/* Description + Memo */}
              <div className="text-green-400/80 text-sm mb-3">
                <div className="break-words">{tx.description}</div>
                {tx.memo && (
                  <div className="mt-1 text-purple-300 break-words">
                    Memo: {tx.memo}
                  </div>
                )}

                {/* Recipient/Sender Address for Private Transfers */}
                {tx.isPrivateTransfer && (tx.recipientAddress || tx.senderAddress) && (
                  <div className="mt-1 text-blue-300 break-words">
                    {tx.recipientAddress ? (
                      <div>
                        <span className="text-blue-400/80">Recipient: </span>
                        <span
                          onClick={() => navigator.clipboard.writeText(tx.recipientLexieId || tx.recipientAddress)}
                          className="cursor-pointer hover:text-blue-200 transition-colors select-all"
                          title={`Click to copy ${tx.recipientLexieId ? 'Lexie ID' : 'recipient address'}`}
                        >
                          {tx.recipientLexieId ? (
                            <span className="text-emerald-300 font-medium">{tx.recipientLexieId}</span>
                          ) : (
                            `${tx.recipientAddress.slice(0, 8)}...${tx.recipientAddress.slice(-6)}`
                          )}
                        </span>
                      </div>
                    ) : tx.senderAddress ? (
                      <div>
                        <span className="text-blue-400/80">Sender: </span>
                        <span
                          onClick={() => navigator.clipboard.writeText(tx.senderLexieId || tx.senderAddress)}
                          className="cursor-pointer hover:text-blue-200 transition-colors select-all"
                          title={`Click to copy ${tx.senderLexieId ? 'Lexie ID' : 'sender address'}`}
                        >
                          {tx.senderLexieId ? (
                            <span className="text-emerald-300 font-medium">{tx.senderLexieId}</span>
                          ) : (
                            `${tx.senderAddress.slice(0, 8)}...${tx.senderAddress.slice(-6)}`
                          )}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Debug logging for memo and address data */}
                {console.log('📧 [TransactionHistory] Rendering transaction with address info:', {
                  txid: tx.txid?.substring(0, 10) + '...',
                  category: tx.category,
                  isPrivateTransfer: tx.isPrivateTransfer,
                  hasMemo: !!tx.memo,
                  memoLength: tx.memo?.length || 0,
                  hasRecipientAddress: !!tx.recipientAddress,
                  hasSenderAddress: !!tx.senderAddress,
                  recipientAddress: tx.recipientAddress?.substring(0, 8) + '...',
                  senderAddress: tx.senderAddress?.substring(0, 8) + '...',
                  recipientLexieId: tx.recipientLexieId,
                  senderLexieId: tx.senderLexieId,
                  displayRecipient: tx.recipientLexieId || tx.recipientAddress?.substring(0, 8) + '...',
                  displaySender: tx.senderLexieId || tx.senderAddress?.substring(0, 8) + '...'
                })}
              </div>

              {/* Transaction ID */}
              <div className="text-green-400/70 text-sm font-mono break-all flex items-center gap-2">
                <span className="text-green-400/80">Transaction ID: </span>
                <span
                  onClick={() => tx.copyTxId()}
                  className="cursor-pointer hover:text-green-300 transition-colors select-all"
                  title="Click to copy Transaction ID"
                >
                  {tx.txid}
                </span>
                {getBlockExplorerUrl(tx.chainId, tx.txid) && (
                  <a
                    href={getBlockExplorerUrl(tx.chainId, tx.txid)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-300 hover:text-purple-200 transition-colors text-xs"
                    title="View in Block Explorer"
                  >
                    □↗
                  </a>
                )}
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Load More Button (if needed) */}
      {displayTransactions.length >= 100 && (
        <div className="text-center mt-6">
          <button
            onClick={() => {/* Implement load more */}}
            className="px-6 py-2 bg-black hover:bg-green-900/20 text-green-200 rounded border border-green-500/40 transition-colors"
          >
            Load More Transactions
          </button>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory; 