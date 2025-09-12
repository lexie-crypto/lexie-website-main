/**
 * Admin History Dashboard
 *
 * Clean implementation using existing backend endpoints:
 * 1. Resolve identifiers to wallet IDs
 * 2. Fetch transaction history from Redis
 * 3. Display results in admin dashboard
 */

import React, { useState } from 'react';
import { getAddress } from 'ethers';

const AdminDashboard = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('eoa'); // 'eoa', 'zkaddress', 'txhash'
  const [isSearching, setIsSearching] = useState(false);

  // Results state
  const [walletId, setWalletId] = useState(null);
  const [resolutionType, setResolutionType] = useState(null);
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedChain, setSelectedChain] = useState(1); // Default to Ethereum

  // UI state
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
    setWalletId(null);
    setResolutionType(null);
    setTransactionHistory([]);
    setLogs([]);
    addLog('Dashboard cleared', 'info');
  };

  // Search for wallet and get transaction history
  const searchWallet = async () => {
    if (!searchQuery.trim()) {
      addLog('Please enter a search query', 'error');
      return;
    }

    setIsSearching(true);
    addLog(`🔍 Searching for: ${searchQuery}`, 'info');

    try {
      // Step 1: Resolve identifier to wallet ID using new path-based endpoints
      addLog('🔍 Resolving identifier to wallet ID...', 'info');

      let resolveEndpoint = '';
      let queryType = '';

      // Normalize EOA to checksum for consistent Redis key matches
      let walletAddressParam = (searchQuery || '').trim();
      if (searchType === 'eoa') {
        try {
          walletAddressParam = getAddress(walletAddressParam);
        } catch (_) {
          addLog('❌ Invalid EOA address format', 'error');
          setIsSearching(false);
          return;
        }
      }

      // Use the existing query parameter approach (same as WalletPage.jsx)
      resolveEndpoint = `/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddressParam)}`;
      queryType = 'Wallet Address';

      addLog(`🔍 Using ${queryType} resolver: ${resolveEndpoint}`, 'info');

      const resolveResponse = await fetch(resolveEndpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!resolveResponse.ok) {
        throw new Error(`Resolution failed: ${resolveResponse.status}`);
      }

      const resolveData = await resolveResponse.json();

      // Handle the existing endpoint format (same as WalletContext.jsx)
      if (!resolveData.success || !resolveData.keys || resolveData.keys.length === 0) {
        addLog(`❌ No wallet found for: ${searchQuery}`, 'error');
        return;
      }

      // Find the first key with a walletId (same logic as WalletContext.jsx)
      const walletKey = resolveData.keys.find(key => key.walletId);
      if (!walletKey || !walletKey.walletId) {
        addLog(`❌ No wallet ID found in metadata for: ${searchQuery}`, 'error');
        return;
      }

      const walletId = walletKey.walletId;
      setWalletId(walletId);
      setResolutionType(queryType);

      addLog(`✅ Found wallet: ${walletId.slice(0, 8)}... (${queryType})`, 'success');

      // Step 2: Get transaction history from wallet timeline endpoint
      await loadWalletTimeline(walletId);

    } catch (error) {
      addLog(`❌ Search failed: ${error.message}`, 'error');
      console.error('Search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  // Load wallet timeline from the new endpoint
  const loadWalletTimeline = async (walletIdToLoad) => {
    setIsLoadingHistory(true);
    addLog(`📊 Loading wallet timeline...`, 'info');

    try {
      // Call the wallet-timeline endpoint through the proxy
      const timelineParams = new URLSearchParams({
        action: 'wallet-timeline',
        walletId: walletIdToLoad,
        page: '1',
        pageSize: '100' // Get up to 100 transactions
      });

      const timelineResponse = await fetch(`/api/wallet-metadata?${timelineParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!timelineResponse.ok) {
        throw new Error(`Timeline fetch failed: ${timelineResponse.status}`);
      }

      const timelineData = await timelineResponse.json();

      if (timelineData.success) {
        // Use the already formatted transactions from the backend
        const transactions = timelineData.timeline || [];
        setTransactionHistory(transactions);

        const totalCount = timelineData.pagination?.total || 0;
        const returnedCount = transactions.length;

        addLog(`✅ Loaded ${returnedCount} transactions${totalCount > returnedCount ? ` (${totalCount} total)` : ''}`, 'success');

        if (transactions.length === 0) {
          addLog('ℹ️ No transactions found for this wallet', 'info');
        }
      } else {
        addLog(`❌ Failed to load timeline: ${timelineData.error || 'Unknown error'}`, 'error');
      }

    } catch (error) {
      addLog(`❌ Timeline loading failed: ${error.message}`, 'error');
      console.error('Timeline loading error:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };


  // Handle enter key in search input
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      searchWallet();
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-400 mb-2">Admin History Dashboard</h1>
          <p className="text-gray-400">Search and view user transaction histories</p>
        </div>

        {/* Search Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🔍 Search Wallet</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Search Type</label>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="eoa">EOA Address (0x...)</option>
                <option value="zkaddress">Railgun Address (0zk...)</option>
                <option value="txhash">Transaction Hash</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {searchType === 'eoa' && 'EOA Address'}
                {searchType === 'zkaddress' && 'Railgun Address'}
                {searchType === 'txhash' && 'Transaction Hash'}
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={`Enter ${searchType === 'eoa' ? 'EOA address' : searchType === 'zkaddress' ? 'Railgun address' : 'transaction hash'}`}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={searchWallet}
                disabled={isSearching || !searchQuery.trim()}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                {isSearching ? '🔍 Searching...' : '🔍 Search'}
              </button>

              <button
                onClick={clearState}
                className="px-6 py-2 bg-gray-600 hover:bg-gray-700 rounded-md transition-colors"
              >
                🗑️ Clear
              </button>
            </div>
          </div>

          {/* Search Results */}
          {walletId && (
            <div className="mt-6 p-4 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ Wallet Found</h3>
              <div className="space-y-1 text-sm text-gray-300">
                <p><strong>Wallet ID:</strong> {walletId}</p>
                <p><strong>Resolution:</strong> {resolutionType}</p>
                <p><strong>Query:</strong> {searchQuery}</p>
              </div>
            </div>
          )}
        </div>

        {/* Transaction History Section */}
        {walletId && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-blue-300">📋 Transaction History</h2>
              <div className="text-sm text-gray-400">
                Wallet: {walletId.slice(0, 8)}...
              </div>
            </div>

            {/* Loading State */}
            {isLoadingHistory && (
              <div className="text-center py-8">
                <div className="text-blue-400">Loading transaction history...</div>
              </div>
            )}

            {/* Transaction List */}
            {!isLoadingHistory && transactionHistory.length > 0 && (
              <div className="space-y-3">
                <div className="text-green-400 font-medium mb-2">
                  📊 Found {transactionHistory.length} transaction{transactionHistory.length !== 1 ? 's' : ''}
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
                            onClick={() => navigator.clipboard.writeText(tx.txid || tx.txHash || '')}
                            className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
                            title="Copy transaction ID"
                          >
                            📋
                          </button>
                        </div>

                        {/* Transaction Details Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
                          {/* Transaction Info */}
                          <div className="space-y-2">
                            <div className="text-xs text-gray-400 font-medium">TRANSACTION INFO</div>

                            {tx.traceId && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Trace ID:</span>
                                <span className="text-xs font-mono text-gray-300 break-all">{tx.traceId}</span>
                              </div>
                            )}

                            {tx.txHash && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">TX Hash:</span>
                                <span className="text-xs font-mono text-gray-300 break-all">{tx.txHash}</span>
                              </div>
                            )}

                            {tx.status && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Status:</span>
                                <span className={`text-xs px-2 py-1 rounded ${
                                  tx.status === 'confirmed' ? 'bg-green-900/30 text-green-300' :
                                  tx.status === 'pending' ? 'bg-yellow-900/30 text-yellow-300' :
                                  'bg-red-900/30 text-red-300'
                                }`}>
                                  {tx.status}
                                </span>
                              </div>
                            )}

                            {tx.id && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">ID:</span>
                                <span className="text-xs font-mono text-gray-300 break-all">{tx.id}</span>
                              </div>
                            )}

                            {tx.timestamp && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Timestamp:</span>
                                <span className="text-xs text-gray-300">{new Date(tx.timestamp * 1000).toLocaleString()}</span>
                              </div>
                            )}

                            {tx.addedAt && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Added At:</span>
                                <span className="text-xs text-gray-300">{new Date(tx.addedAt).toLocaleString()}</span>
                              </div>
                            )}
                          </div>

                          {/* Token & Address Info */}
                          <div className="space-y-2">
                            <div className="text-xs text-gray-400 font-medium">TOKEN & ADDRESS INFO</div>

                            {tx.token && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Token:</span>
                                <span className="text-xs text-blue-300 font-medium">{tx.token}</span>
                              </div>
                            )}

                            {tx.amount && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Amount:</span>
                                <span className="text-xs text-green-300 font-medium">{tx.amount}</span>
                              </div>
                            )}

                            {tx.zkAddr && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">ZK Address:</span>
                                <span className="text-xs font-mono text-purple-300 break-all">{tx.zkAddr}</span>
                              </div>
                            )}

                            {tx.recipientAddress && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Recipient:</span>
                                <span className="text-xs font-mono text-orange-300 break-all">{tx.recipientAddress}</span>
                              </div>
                            )}

                            {tx.senderAddress && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Sender:</span>
                                <span className="text-xs font-mono text-orange-300 break-all">{tx.senderAddress}</span>
                              </div>
                            )}

                            {tx.nullifiers && tx.nullifiers.length > 0 && (
                              <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Nullifiers:</span>
                                <span className="text-xs text-red-300">{tx.nullifiers.length} nullifier{tx.nullifiers.length !== 1 ? 's' : ''}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Private Memo - Full Width */}
                        {tx.memo && (
                          <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/50 rounded">
                            <div className="text-blue-300 text-xs font-medium mb-2">📝 Private Memo:</div>
                            <div className="text-blue-200 text-sm whitespace-pre-wrap">{tx.memo}</div>
                          </div>
                        )}

                        {/* Legacy Token Amounts (if present) */}
                        {tx.tokenAmounts && tx.tokenAmounts.length > 0 && (
                          <div className="mt-3 p-3 bg-green-900/20 border border-green-700/50 rounded">
                            <div className="text-green-300 text-xs font-medium mb-2">💰 Token Amounts:</div>
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
                          </div>
                        )}

                        {/* Raw JSON for debugging */}
                        <details className="mt-3">
                          <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                            🔍 Raw Transaction Data
                          </summary>
                          <pre className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-400 overflow-x-auto">
                            {JSON.stringify(tx, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* No Transactions Message */}
            {!isLoadingHistory && transactionHistory.length === 0 && walletId && (
              <div className="text-center py-8 text-gray-400">
                No transactions found for this wallet
              </div>
            )}
          </div>
        )}

        {/* Activity Logs */}
        <div className="bg-gray-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">📋 Activity Logs</h2>

          <div className="bg-gray-900 rounded-md p-4 max-h-64 overflow-y-auto">
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
