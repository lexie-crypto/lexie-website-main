/**
 * Admin Dashboard - Direct Wallet Access
 *
 * SIMPLIFIED APPROACH - Direct wallet loading with full admin access
 *
 * Features:
 * 1. Search for user's wallet using existing wallet-metadata routes
 * 2. Load wallet directly with full access using decrypted mnemonic
 * 3. Follow Railgun documentation for encryption keys and wallet loading
 * 4. Comprehensive logging for each step
 * 5. Full admin access to wallet transactions and details
 */

import React, { useState, useEffect } from 'react';


const AdminDashboard = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('zkaddress'); // 'zkaddress', 'eoa', 'txhash'
  const [isSearching, setIsSearching] = useState(false);

  // Metadata state
  const [resolvedWalletId, setResolvedWalletId] = useState(null);
  const [resolvedWalletAddress, setResolvedWalletAddress] = useState(null);
  const [encryptionKey, setEncryptionKey] = useState(null);

  // Simplified state - no complex wallet loading needed
  const [isLoading, setIsLoading] = useState(false);

  // Transaction history state
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedHistoryChain, setSelectedHistoryChain] = useState(1); // Default to Ethereum

  // Logs state
  const [logs, setLogs] = useState([]);

  // Add log entry
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      message,
      type
    };
    setLogs(prev => [...prev, logEntry]);
    console.log(`[${type.toUpperCase()}] ${message}`);
  };

  // Clear all state
  const clearState = () => {
    // No complex wallet unloading needed - we're not loading wallets anymore
    setResolvedWalletId(null);
    setResolvedWalletAddress(null);
    setEncryptionKey(null);
    setTransactionHistory([]);
    setLogs([]);
    addLog('Dashboard cleared', 'info');
  };

  // Get basic wallet metadata (simplified approach - no complex wallet loading needed)
  const getWalletMetadata = async () => {
    if (!searchQuery.trim()) {
      addLog('Search query is empty', 'error');
      return;
    }

    setIsSearching(true);
    addLog(`🔍 Getting wallet metadata for: ${searchQuery}`, 'info');

    try {
      // Simple metadata lookup - no complex encryption key derivation needed
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(searchQuery)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.keys && data.keys.length > 0) {
        const walletMetadata = data.keys[0];
        if (walletMetadata && walletMetadata.walletId) {
          setResolvedWalletId(walletMetadata.walletId);
          setResolvedWalletAddress(searchQuery);

          console.log('[AdminHistoryPage] 📦 Metadata extracted:');
          console.log('[AdminHistoryPage] 🆔 Wallet ID:', walletMetadata.walletId);

          addLog(`✅ Wallet metadata retrieved successfully`, 'success');
          addLog(`📍 Wallet ID: ${walletMetadata.walletId.slice(0, 8)}...`, 'info');

          // No encryption key needed - we get transaction history directly from Redis
          addLog(`📝 Ready to fetch transaction history directly from Redis`, 'info');
        } else {
          throw new Error('No wallet metadata found');
        }
      } else {
        throw new Error(data.error || 'No wallet metadata found');
      }

    } catch (error) {
      addLog(`❌ Wallet metadata retrieval failed: ${error.message}`, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // Get transaction history using existing endpoints (TWO-STEP PROCESS)
  const getWalletHistory = async () => {
    if (!searchQuery.trim()) {
      addLog('No search query available for history lookup', 'error');
      return;
    }

    setIsLoadingHistory(true);
    addLog(`🔍 Getting transaction history for: ${searchQuery.slice(0, 8)}... on chain ${selectedHistoryChain}`, 'info');

    try {
      // STEP 1: Resolve the search query to a wallet ID using existing endpoint
      console.log('[AdminHistoryPage] 🔍 Step 1: Resolving identifier to wallet ID');
      const resolveParams = new URLSearchParams({
        action: 'history',
        subaction: 'resolve',
        q: searchQuery
      });

      const resolveResponse = await fetch(`/api/wallet-metadata?${resolveParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!resolveResponse.ok) {
        throw new Error(`Resolution failed: HTTP ${resolveResponse.status}`);
      }

      const resolveData = await resolveResponse.json();
      console.log('[AdminHistoryPage] ✅ Resolution result:', {
        success: resolveData.success,
        walletId: resolveData.walletId?.slice(0, 8) + '...',
        resolutionType: resolveData.resolutionType
      });

      if (!resolveData.success || !resolveData.walletId) {
        addLog(`❌ Could not resolve ${searchQuery} to a wallet`, 'error');
        setTransactionHistory([]);
        return;
      }

      // Update resolved wallet ID
      setResolvedWalletId(resolveData.walletId);
      addLog(`✅ Resolved ${resolveData.resolutionType}: ${resolveData.walletId.slice(0, 8)}...`, 'success');

      // STEP 2: Get transaction history using existing paginated endpoint
      console.log('[AdminHistoryPage] 📊 Step 2: Getting transaction history');
      const historyParams = new URLSearchParams({
        action: 'history',
        walletId: resolveData.walletId,
        page: '1',
        pageSize: '1000' // Get all transactions (reasonable limit)
      });

      const historyResponse = await fetch(`/api/wallet-metadata?${historyParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!historyResponse.ok) {
        throw new Error(`History fetch failed: HTTP ${historyResponse.status}`);
      }

      const historyData = await historyResponse.json();
      console.log('[AdminHistoryPage] 📊 History response:', {
        success: historyData.success,
        totalItems: historyData.pagination?.total || 0,
        returnedItems: historyData.items?.length || 0,
        hasMore: historyData.pagination?.hasMore || false
      });

      if (historyData.success) {
        // Format transactions for UI display (similar to transactionHistory.js)
        const formattedTransactions = (historyData.items || []).map(tx => ({
          ...tx,
          // Add UI formatting similar to what transactionHistory.js does
          date: tx.timestamp ? new Date(tx.timestamp * 1000) : null,
          transactionType: getTransactionType(tx.type),
          isPrivateTransfer: tx.type === 'transfer_send' || tx.type === 'transfer_receive',
          copyTxId: async () => {
            try {
              await navigator.clipboard.writeText(tx.txid || tx.txHash || '');
              console.log('[AdminHistoryPage] ✅ Transaction ID copied to clipboard');
            } catch (error) {
              console.error('[AdminHistoryPage] ❌ Failed to copy transaction ID:', error);
            }
          }
        }));

        setTransactionHistory(formattedTransactions);

        const totalCount = historyData.pagination?.total || 0;
        const returnedCount = historyData.items?.length || 0;

        addLog(`✅ Retrieved ${returnedCount} transactions${totalCount > returnedCount ? ` (showing first page of ${totalCount} total)` : ''}`, 'success');

        if (formattedTransactions.length > 0) {
          const latestTx = formattedTransactions[0];
          addLog(`📅 Latest transaction: ${latestTx.transactionType} at ${latestTx.date?.toLocaleString()}`, 'info');
        } else {
          addLog('ℹ️ No transactions found for this wallet', 'info');
          console.log('[AdminHistoryPage] ℹ️ No transactions found - possible reasons:');
          console.log('[AdminHistoryPage]   • Wallet exists but has no tracked transactions');
          console.log('[AdminHistoryPage]   • Transaction tracking may not be enabled for this wallet');
        }

        // Log pagination info
        if (historyData.pagination) {
          console.log('[AdminHistoryPage] 📄 Pagination info:', {
            page: historyData.pagination.page,
            pageSize: historyData.pagination.pageSize,
            total: historyData.pagination.total,
            hasMore: historyData.pagination.hasMore
          });
        }

      } else {
        addLog(`❌ Failed to retrieve history: ${historyData.error || 'Unknown error'}`, 'error');
        setTransactionHistory([]);
      }

    } catch (error) {
      addLog(`❌ History retrieval failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] History retrieval error:', error);
      setTransactionHistory([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Helper function to format transaction types for UI
  const getTransactionType = (type) => {
    const typeMap = {
      'shield': 'Add to Vault',
      'unshield': 'Remove from Vault',
      'transfer_send': 'Send Transaction',
      'transfer_receive': 'Receive Transaction'
    };
    return typeMap[type] || 'Unknown';
  };

  // Auto-fetch transaction history when wallet ID is resolved
  // No complex wallet loading needed - we get data directly from Redis
  useEffect(() => {
    if (resolvedWalletId && !isLoadingHistory) {
      getWalletHistory();
    }
  }, [resolvedWalletId, isLoadingHistory]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-400 mb-2">Admin Dashboard</h1>
          <p className="text-gray-400">Direct wallet access with full admin privileges using existing Railgun infrastructure</p>
        </div>

        {/* Search Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🔍 Get Wallet Metadata</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Search Type</label>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="zkaddress">Railgun Address (0zk...)</option>
                <option value="eoa">EOA Address (0x...)</option>
                <option value="txhash">Transaction Hash</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Search Query</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Enter ${searchType}...`}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={getWalletMetadata}
                disabled={isSearching || !searchQuery.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                {isSearching ? '🔍 Searching...' : '🔍 Get Metadata'}
              </button>

              <button
                onClick={clearState}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md transition-colors"
              >
                🗑️ Clear
              </button>
            </div>
          </div>

          {/* Metadata Results */}
          {resolvedWalletId && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ Wallet Metadata Retrieved</h3>
              <p className="text-sm text-gray-300">
                <strong>Wallet ID:</strong> {resolvedWalletId}
              </p>
              <p className="text-sm text-gray-300">
                <strong>Wallet Address:</strong> {resolvedWalletAddress}
              </p>
            </div>
          )}
        </div>

        {/* Transaction History Section */}
        {resolvedWalletId && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-blue-300">📋 Transaction History</h2>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Chain ID</label>
                  <select
                    value={selectedHistoryChain}
                    onChange={(e) => setSelectedHistoryChain(parseInt(e.target.value))}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value={1}>Ethereum (1)</option>
                    <option value={42161}>Arbitrum (42161)</option>
                    <option value={137}>Polygon (137)</option>
                    <option value={56}>BNB Chain (56)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={getWalletHistory}
                    disabled={isLoadingHistory || !resolvedWalletId}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
                  >
                    {isLoadingHistory ? '🔍 Getting History...' : '🔍 Get History'}
                  </button>
                </div>
              </div>

              {/* Transaction History Display */}
              {transactionHistory.length > 0 && (
                <div className="mt-4">
                  <div className="text-green-400 font-medium mb-2">
                    📊 Found {transactionHistory.length} transaction{transactionHistory.length !== 1 ? 's' : ''} on chain {selectedHistoryChain}
                  </div>
                  <div className="bg-gray-900 rounded-md p-4 max-h-96 overflow-y-auto">
                    <div className="space-y-3">
                      {transactionHistory.map((tx, index) => (
                        <div key={index} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                tx.transactionType === 'Add to Vault' ? 'bg-green-900 text-green-300' :
                                tx.transactionType === 'Remove from Vault' ? 'bg-red-900 text-red-300' :
                                tx.transactionType === 'Send Transaction' ? 'bg-blue-900 text-blue-300' :
                                tx.transactionType === 'Receive Transaction' ? 'bg-purple-900 text-purple-300' :
                                'bg-gray-900 text-gray-300'
                              }`}>
                                {tx.transactionType}
                              </span>
                              <span className="text-xs text-gray-400">
                                {tx.date?.toLocaleString() || 'Unknown date'}
                              </span>
                            </div>
                            <button
                              onClick={() => tx.copyTxId && tx.copyTxId()}
                              className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
                              title="Copy transaction ID"
                            >
                              📋
                            </button>
                          </div>

                          <div className="text-sm text-gray-300 mb-2">
                            {tx.description || 'Transaction'}
                          </div>

                          {tx.tokenAmounts && tx.tokenAmounts.length > 0 && (
                            <div className="space-y-1">
                              {tx.tokenAmounts.map((amount, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm">
                                  <span className="text-green-400 font-medium">
                                    {amount.formattedAmount} {amount.symbol}
                                  </span>
                                  {amount.tokenAddress && (
                                    <span className="text-xs text-gray-500 font-mono">
                                      {amount.tokenAddress.slice(0, 6)}...{amount.tokenAddress.slice(-4)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {tx.isPrivateTransfer && tx.memo && (
                            <div className="mt-2 p-2 bg-blue-900/20 border border-blue-700/50 rounded text-sm">
                              <div className="text-blue-300 text-xs font-medium mb-1">Private Memo:</div>
                              <div className="text-blue-200">{tx.memo}</div>
                            </div>
                          )}

                          <div className="mt-2 text-xs text-gray-500 font-mono">
                            TX: {tx.txid?.slice(0, 12)}...{tx.txid?.slice(-8)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Encryption Key Missing Message */}
              {!encryptionKey && resolvedWalletId && (
                <div className="text-center py-4 text-yellow-400 bg-yellow-900/20 rounded-md border border-yellow-700/50">
                  ⚠️ Cannot load wallet: Failed to derive local encryption key.
                  <br />
                  <span className="text-sm text-yellow-300">Admin wallet access requires a valid local encryption key derived from wallet data.</span>
                </div>
              )}

              {/* No History Message */}
              {transactionHistory.length === 0 && !isLoadingHistory && resolvedWalletId && (
                <div className="text-center py-4 text-gray-400">
                  No transactions found on chain {selectedHistoryChain}. Try a different chain or this wallet may not have any transactions yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs Section */}
        {resolvedWalletId && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4 text-blue-300">📋 Transaction History</h2>

            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Chain ID</label>
                  <select
                    value={selectedHistoryChain}
                    onChange={(e) => setSelectedHistoryChain(parseInt(e.target.value))}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value={1}>Ethereum (1)</option>
                    <option value={42161}>Arbitrum (42161)</option>
                    <option value={137}>Polygon (137)</option>
                    <option value={56}>BNB Chain (56)</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={getWalletHistory}
                    disabled={isLoadingHistory || !resolvedWalletId || !encryptionKey}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
                  >
                    {isLoadingHistory ? '🔍 Getting History...' : '🔍 Get History'}
                  </button>
                </div>
              </div>

              {/* Transaction History Display */}
              {transactionHistory.length > 0 && (
                <div className="mt-4">
                  <div className="text-green-400 font-medium mb-2">
                    📊 Found {transactionHistory.length} transaction{transactionHistory.length !== 1 ? 's' : ''} on chain {selectedHistoryChain}
                  </div>
                  <div className="bg-gray-900 rounded-md p-4 max-h-96 overflow-y-auto">
                    <div className="space-y-3">
                      {transactionHistory.map((tx, index) => (
                        <div key={index} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                tx.transactionType === 'Add to Vault' ? 'bg-green-900 text-green-300' :
                                tx.transactionType === 'Remove from Vault' ? 'bg-red-900 text-red-300' :
                                tx.transactionType === 'Send Transaction' ? 'bg-blue-900 text-blue-300' :
                                tx.transactionType === 'Receive Transaction' ? 'bg-purple-900 text-purple-300' :
                                'bg-gray-900 text-gray-300'
                              }`}>
                                {tx.transactionType}
                              </span>
                              <span className="text-xs text-gray-400">
                                {tx.date?.toLocaleString() || 'Unknown date'}
                              </span>
                            </div>
                            <button
                              onClick={() => navigator.clipboard.writeText(tx.txid)}
                              className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
                              title="Copy transaction ID"
                            >
                              📋
                            </button>
                          </div>

                          <div className="text-sm text-gray-300 mb-2">
                            {tx.description}
                          </div>

                          {tx.tokenAmounts && tx.tokenAmounts.length > 0 && (
                            <div className="space-y-1">
                              {tx.tokenAmounts.map((amount, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm">
                                  <span className="text-green-400 font-medium">
                                    {amount.formattedAmount} {amount.symbol}
                                  </span>
                                  {amount.tokenAddress && (
                                    <span className="text-xs text-gray-500 font-mono">
                                      {amount.tokenAddress.slice(0, 6)}...{amount.tokenAddress.slice(-4)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {tx.isPrivateTransfer && tx.memo && (
                            <div className="mt-2 p-2 bg-blue-900/20 border border-blue-700/50 rounded text-sm">
                              <div className="text-blue-300 text-xs font-medium mb-1">Private Memo:</div>
                              <div className="text-blue-200">{tx.memo}</div>
                            </div>
                          )}

                          <div className="mt-2 text-xs text-gray-500 font-mono">
                            TX: {tx.txid.slice(0, 12)}...{tx.txid.slice(-8)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Encryption Key Missing Message */}
              {!encryptionKey && resolvedWalletId && (
                <div className="text-center py-4 text-yellow-400 bg-yellow-900/20 rounded-md border border-yellow-700/50">
                  ⚠️ Cannot load wallet: Failed to derive local encryption key.
                  <br />
                  <span className="text-sm text-yellow-300">Admin wallet access requires a valid local encryption key derived from wallet data.</span>
                </div>
              )}

              {/* No History Message */}
              {transactionHistory.length === 0 && !isLoadingHistory && resolvedWalletId && encryptionKey && (
                <div className="text-center py-4 text-gray-400">
                  No transactions found on chain {selectedHistoryChain}. Try a different chain or this wallet may not have any transactions yet.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs Section */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">📋 Activity Logs</h2>

          <div className="bg-gray-900 rounded-md p-4 max-h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-gray-500 text-center">No logs yet. Start by searching for a wallet.</p>
            ) : (
              <div className="space-y-2">
                {logs.map((log, index) => (
                  <div key={index} className={`text-sm p-2 rounded-md ${
                    log.type === 'error' ? 'bg-red-900/30 text-red-300' :
                    log.type === 'success' ? 'bg-green-900/30 text-green-300' :
                    log.type === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                    'bg-gray-700/30 text-gray-300'
                  }`}>
                    <span className="text-xs text-gray-500 mr-2">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span>{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;