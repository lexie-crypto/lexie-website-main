/**
 * TransactionHistory Component
 * Displays RAILGUN private transaction history with filtering and search
 */

import React, { useState } from 'react';
import useTransactionHistory from '../hooks/useTransactionHistory';
import { TransactionCategory, formatTokenAmount, getTokenDecimals, lookupLexieId } from '../utils/railgun/transactionHistory';
import { useWallet } from '../contexts/WalletContext';
import { useContacts } from '../hooks/useContacts';

// Component to display Lexie ID or Railgun address
const LexieIdOrAddress = ({ railgunAddress, fallbackDisplay }) => {
  const [lexieId, setLexieId] = useState(null);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    const lookupId = async () => {
      if (!railgunAddress) return;

      setLoading(true);
      try {
        // Try Railgun address lookup (works for 0zk addresses)
        let id = null;

        if (railgunAddress.startsWith('0zk')) {
          // This is a Railgun address, look it up directly
          id = await lookupLexieId(railgunAddress);
        } else if (railgunAddress.startsWith('0x') && railgunAddress.length === 42) {
          // This is an EOA address, try to resolve it
          console.log('🔄 [LEXIE_LOOKUP] EOA address detected, attempting resolution:', railgunAddress.slice(0, 10) + '...');
          try {
            // First get the wallet ID for this EOA
            const resolveResponse = await fetch(`/api/wallet-metadata?action=resolve-wallet-id&type=by-eoa&identifier=${encodeURIComponent(railgunAddress)}`);
            if (resolveResponse.ok) {
              const resolveData = await resolveResponse.json();
              if (resolveData.success && resolveData.walletId) {
                // Now we have the wallet ID, but we need to get the associated data
                // For now, we'll just show the EOA address since we don't have a direct EOA->LexieID endpoint
                console.log('ℹ️ [LEXIE_LOOKUP] Resolved EOA to wallet ID, but no direct Lexie ID lookup available:', resolveData.walletId);
              }
            }
          } catch (resolveError) {
            console.warn('⚠️ [LEXIE_LOOKUP] EOA resolution failed:', resolveError.message);
          }
        }

        setLexieId(id);
      } catch (error) {
        console.error('Failed to lookup Lexie ID:', error);
        setLexieId(null);
      } finally {
        setLoading(false);
      }
    };

    lookupId();
  }, [railgunAddress]);

  if (loading) {
    return <span className="text-gray-400">Loading...</span>;
  }

  // For EOA addresses that couldn't be resolved, show a cleaner format
  const displayText = lexieId ? `@${lexieId}` :
    (railgunAddress.startsWith('0x') && railgunAddress.length === 42) ?
      `${railgunAddress.slice(0, 6)}...${railgunAddress.slice(-4)}` :
      fallbackDisplay;

  return (
    <span
      onClick={() => navigator.clipboard.writeText(lexieId || railgunAddress)}
      className="cursor-pointer hover:text-blue-200 transition-colors select-all"
      title={`Click to copy ${lexieId ? 'Lexie ID' : 'address'}`}
    >
      {lexieId ? (
        <span className="text-emerald-300 font-medium">{displayText}</span>
      ) : (
        <span className="text-gray-300">{displayText}</span>
      )}
    </span>
  );
};

const TransactionHistory = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Debug wallet context values
  const { chainId, railgunWalletId, isRailgunInitialized, canUseRailgun, address } = useWallet();

  // Contacts for address resolution
  const { contacts, searchContacts } = useContacts();
  
  React.useEffect(() => {
    console.log('[TransactionHistory] Wallet context debug:', {
      chainId,
      hasRailgunWalletId: !!railgunWalletId,
      railgunWalletId: railgunWalletId?.slice(0, 8) + '...' || 'null',
      address: address?.slice(0, 8) + '...' || 'null',
      isRailgunInitialized,
      canUseRailgun,
      userAgent: navigator.userAgent.includes('Mobile') ? 'Mobile' : 'Desktop'
    });
  }, [chainId, railgunWalletId, isRailgunInitialized, canUseRailgun, address]);

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


  // Find contact name for an address
  const findContactName = (address) => {
    if (!address || !contacts.length) return null;

    // Search for contacts by address
    const matchingContacts = searchContacts(address, 1);

    if (matchingContacts.length > 0) {
      const contact = matchingContacts[0];
      // Return contact ID with @ prefix for display
      return `@${contact.id}`;
    }

    return null;
  };

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
                      Time: {tx.date ? (tx.date instanceof Date ? tx.date.toLocaleString() : new Date(tx.date).toLocaleString()) : 'Unknown time'}
                    </div>
                  </div>
                </div>
                {tx.status && (
                  <span className={`text-xs px-2 py-1 rounded ${
                    tx.status === 'confirmed' ? 'bg-green-900/30 text-green-300' :
                    tx.status === 'pending' ? 'bg-yellow-900/30 text-yellow-300' :
                    'bg-red-900/30 text-red-300'
                  }`}>
                    {tx.status}
                  </span>
                )}
              </div>

              {/* Token Amounts */}
              <div className="mb-3">
                {(() => {
                  console.log('💰 [TransactionHistory] Token amount debug for tx:', {
                    txid: tx.txid?.substring(0, 10) + '...',
                    hasTokenAmounts: !!tx.tokenAmounts,
                    tokenAmountsLength: tx.tokenAmounts?.length || 0,
                    firstTokenAmount: tx.tokenAmounts?.[0],
                    hasToken: !!tx.token,
                    amount: tx.amount,
                    amountType: typeof tx.amount,
                    isPrivateTransfer: tx.isPrivateTransfer
                  });

                  // Use the same logic as AdminHistoryPage - display amount directly if available
                  return tx.amount !== undefined && tx.amount !== null ? (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-1 gap-1">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="text-green-200 font-medium">{tx.token || 'USDC'}</span>
                      </div>
                      <div className="text-green-200 font-medium text-right">
                        {typeof tx.amount === 'string' ? tx.amount : tx.amount.toString()}
                      </div>
                    </div>
                  ) : tx.tokenAmounts && tx.tokenAmounts.length > 0 ? (
                    tx.tokenAmounts.map((token, index) => (
                      <div key={index} className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-1 gap-1">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span className="text-green-200 font-medium">{token.symbol}</span>
                        </div>
                        <div className="text-green-200 font-medium text-right">
                          {token.formattedAmount}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-green-400/70 text-sm italic">
                      No token amounts available
                    </div>
                  );
                })()}
              </div>

              {/* Description + Memo */}
              <div className="text-green-400/80 text-sm mb-3">
                <div className="break-words">{tx.description}</div>
                {tx.memo && (
                  <div className="mt-1 text-purple-300 break-words">
                    Memo: {tx.memo}
                  </div>
                )}

                {/* To/From Display for All Transaction Types */}
                {(() => {
                  // Calculate toFrom field exactly like AdminHistoryPage
                  let toFrom = null;

                  if (tx.transactionType === 'Add to Vault') {
                    // Shield transactions: show the EOA that initiated the shield
                    toFrom = {
                      direction: 'from',
                      display: 'Your Wallet (EOA)',
                      type: 'eoa'
                    };
                  } else if (tx.transactionType === 'Remove from Vault') {
                    // Unshield transactions: show the EOA that received the funds
                    const contactName = findContactName(tx.recipientAddress);
                    toFrom = {
                      direction: 'to',
                      display: contactName || (tx.recipientAddress
                        ? `${tx.recipientAddress.slice(0, 8)}...${tx.recipientAddress.slice(-6)}`
                        : 'External Address'),
                      fullAddress: tx.recipientAddress,
                      type: contactName ? 'contact' : (tx.recipientAddress ? 'eoa' : 'external')
                    };
                  }
                  // Skip To/From display for private transfers - we show Lexie ID/contact info separately

                  return toFrom ? (
                    <div className="mt-1 text-blue-300 break-words">
                      <span className="text-blue-400/80">
                        {toFrom.direction === 'to' ? 'To: ' : 'From: '}
                      </span>
                      <span
                        onClick={() => toFrom.fullAddress ? navigator.clipboard.writeText(toFrom.fullAddress) : null}
                        className={`cursor-pointer hover:text-blue-200 transition-colors select-all ${!toFrom.fullAddress ? 'cursor-default' : ''}`}
                        title={toFrom.fullAddress ? `Click to copy ${toFrom.type === 'contact' ? 'contact address' : toFrom.type === 'vault' ? 'vault reference' : 'address'}` : ''}
                      >
                        {toFrom.display}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* Recipient/Sender Address for Private Transfers */}
                {tx.isPrivateTransfer && (tx.recipientAddress || tx.senderAddress) && (
                  <div className="mt-1 text-blue-300 break-words">
                    {tx.transactionType === 'Receive Transaction' && tx.senderAddress ? (
                      <div>
                        <span className="text-blue-400/80">From LexieID: </span>
                        <LexieIdOrAddress
                          railgunAddress={tx.senderAddress}
                          fallbackDisplay={`${tx.senderAddress.slice(0, 8)}...${tx.senderAddress.slice(-6)}`}
                        />
                      </div>
                    ) : tx.transactionType === 'Send Transaction' && tx.recipientAddress ? (
                      <div>
                        <span className="text-blue-400/80">To LexieID: </span>
                        <LexieIdOrAddress
                          railgunAddress={tx.recipientAddress}
                          fallbackDisplay={`${tx.recipientAddress.slice(0, 8)}...${tx.recipientAddress.slice(-6)}`}
                        />
                      </div>
                    ) : tx.senderAddress ? (
                      <div>
                        <span className="text-blue-400/80">From: </span>
                        <LexieIdOrAddress
                          railgunAddress={tx.senderAddress}
                          fallbackDisplay={`${tx.senderAddress.slice(0, 8)}...${tx.senderAddress.slice(-6)}`}
                        />
                      </div>
                    ) : tx.recipientAddress ? (
                      <div>
                        <span className="text-blue-400/80">To: </span>
                        <LexieIdOrAddress
                          railgunAddress={tx.recipientAddress}
                          fallbackDisplay={`${tx.recipientAddress.slice(0, 8)}...${tx.recipientAddress.slice(-6)}`}
                        />
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Debug logging for memo and address data */}
                {(() => {
                  // Safely log transaction data (avoid BigInt serialization issues)
                  const safeTxData = {
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
                    hasToFrom: !!tx.toFrom,
                    toFromDirection: tx.toFrom?.direction,
                    toFromDisplay: tx.toFrom?.display,
                    toFromType: tx.toFrom?.type,
                    currentWalletAddress: address?.substring(0, 8) + '...'
                  };
                  console.log('📧 [TransactionHistory] Rendering transaction with address info:', safeTxData);
                  return null;
                })()}
              </div>

              {/* Transaction ID (legacy - keep for backward compatibility) */}
              <div className="text-green-400/70 text-sm font-mono break-all flex items-center gap-2 mt-3">
                <span className="text-green-400/80">Transaction ID: </span>
                <span
                  onClick={() => tx.copyTxId ? tx.copyTxId() : null}
                  className="cursor-pointer hover:text-green-300 transition-colors select-all"
                  title="Click to copy Transaction ID"
                >
                  {tx.txid || tx.traceId || tx.txHash || tx.id || 'N/A'}
                </span>
                {(tx.txid || tx.txHash || tx.traceId) && (
                  <a
                    href={getBlockExplorerUrl(chainId, tx.txid || tx.txHash || tx.traceId) || `https://etherscan.io/tx/${tx.txid || tx.txHash || tx.traceId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-300 hover:text-purple-200 transition-colors text-xs ml-2"
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