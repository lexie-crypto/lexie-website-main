/**
 * Admin Dashboard - View-Only Wallet Creation
 *
 * BRAND NEW FILE - Not based on any existing admin dashboard code
 *
 * Features:
 * 1. Search for user's wallet metadata (encryption key + wallet ID)
 * 2. Load existing wallet as view-only using official SDK pattern
 * 3. Access transaction history directly from loaded view-only wallet
 * 4. Follow Railgun documentation for encryption keys and view-only wallets
 * 5. Comprehensive logging for each step
 */

import React, { useState, useEffect } from 'react';
import { loadWallet, unloadWallet } from '../utils/railgun/wallet.js';
import { waitForRailgunReady } from '../utils/railgun/engine.js';
import { getTransactionHistory } from '../utils/railgun/transactionHistory.js';


const AdminDashboard = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('zkaddress'); // 'zkaddress', 'eoa', 'txhash'
  const [isSearching, setIsSearching] = useState(false);

  // Metadata state
  const [resolvedWalletId, setResolvedWalletId] = useState(null);
  const [resolvedWalletAddress, setResolvedWalletAddress] = useState(null);
  const [encryptionKey, setEncryptionKey] = useState(null);

  // View-only wallet state
  const [viewOnlyWallet, setViewOnlyWallet] = useState(null);
  const [isLoadingViewOnly, setIsLoadingViewOnly] = useState(false);

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
    // Unload wallets if they're loaded
    if (resolvedWalletId) {
      unloadWallet(resolvedWalletId).catch(error =>
        console.warn('[AdminHistoryPage] Failed to unload resolved wallet on clear:', error)
      );
    }

    // Also unload the view-only wallet we created
    if (viewOnlyWallet?.id) {
      unloadWallet(viewOnlyWallet.id).catch(error =>
        console.warn('[AdminHistoryPage] Failed to unload view-only wallet on clear:', error)
      );
    }

    setResolvedWalletId(null);
    setResolvedWalletAddress(null);
    setEncryptionKey(null);
    setViewOnlyWallet(null);
    setTransactionHistory([]);
    setLogs([]);
    addLog('Dashboard cleared', 'info');
  };

  // Get wallet metadata using regular endpoint
  const getWalletMetadata = async () => {
    if (!searchQuery.trim()) {
      addLog('Search query is empty', 'error');
      return;
    }

    setIsSearching(true);
    addLog(`🔍 Getting wallet metadata for: ${searchQuery}`, 'info');

    try {
      // Use wallet-metadata proxy (HMAC headers are generated server-side by the API proxy)
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
        // Find any key with wallet metadata
        const keyWithMetadata = data.keys.find(key => key.walletId && key.encryptionKey);
        if (keyWithMetadata) {
          setResolvedWalletId(keyWithMetadata.walletId);
          setResolvedWalletAddress(searchQuery);
          setEncryptionKey(keyWithMetadata.encryptionKey);

          console.log('[AdminHistoryPage] 📦 Metadata extracted:');
          console.log('[AdminHistoryPage] 🆔 Wallet ID:', keyWithMetadata.walletId);
          console.log('[AdminHistoryPage] 🔐 Encryption key:', keyWithMetadata.encryptionKey ? `(length: ${keyWithMetadata.encryptionKey.length})` : 'null');

          addLog(`✅ Wallet metadata retrieved successfully`, 'success');
          addLog(`📍 Wallet ID: ${keyWithMetadata.walletId.slice(0, 8)}...`, 'info');
          addLog(`🔑 Encryption key loaded from metadata`, 'success');
          addLog(`📝 Will load existing wallet and generate SVK for view-only access`, 'info');
        } else {
          throw new Error('No wallet metadata found with encryption key');
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



  // Load existing wallet as view-only for transaction history access (MATCH OFFICIAL SDK)
  const loadViewOnlyWallet = async () => {
    if (!resolvedWalletId) {
      addLog('Missing wallet ID for view-only wallet loading', 'error');
      return;
    }

    if (!encryptionKey) {
      addLog('❌ Cannot load view-only wallet: No encryption key available', 'error');
      setViewOnlyWallet(null);
      return;
    }

    setIsLoadingViewOnly(true);
    addLog('📥 Loading existing wallet as view-only...', 'info');

    try {
      // Ensure Railgun engine is ready
      await waitForRailgunReady();
      addLog('✅ Railgun engine ready', 'success');

      console.log('[AdminHistoryPage] 🔐 Loading existing wallet as view-only:', {
        resolvedWalletId: resolvedWalletId?.slice(0, 8) + '...',
        encryptionKeyLength: encryptionKey?.length,
        encryptionKeyPrefix: encryptionKey?.slice(0, 16) + '...'
      });

      // STEP 1: Load existing wallet as view-only (MATCH OFFICIAL SDK)
      addLog('📥 Loading existing wallet as view-only...', 'info');
      const existingWalletInfo = await loadWallet(encryptionKey, resolvedWalletId, true); // isViewOnly = true

      console.log('[AdminHistoryPage] ✅ Existing wallet loaded as view-only!');
      console.log('[AdminHistoryPage] 🆔 Loaded wallet ID:', existingWalletInfo.id?.slice(0, 8));
      console.log('[AdminHistoryPage] 🚀 Railgun address:', existingWalletInfo.railgunAddress?.slice(0, 10));

      addLog(`✅ Existing wallet loaded: ${existingWalletInfo.id?.slice(0, 8)}...`, 'success');
      addLog(`✅ Railgun Address: ${existingWalletInfo.railgunAddress}`, 'success');

      // ✅ STEP 2: Use loaded view-only wallet directly for transaction history
      // No need to generate SVK since we already have the view-only wallet loaded
      addLog('✅ View-only wallet ready for transaction history', 'success');

      setViewOnlyWallet(existingWalletInfo);
      addLog(`✅ View-only wallet ready: ${existingWalletInfo.id?.slice(0, 8)}...`, 'success');

    } catch (error) {
      addLog(`❌ View-only wallet loading failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] View-only wallet loading error:', error);
    } finally {
      setIsLoadingViewOnly(false);
    }
  };

  // Get transaction history using official SDK (SAME AS WALLET PAGE)
  const getWalletHistory = async () => {
    if (!resolvedWalletId) {
      addLog('No wallet ID available for history', 'error');
      return;
    }

    setIsLoadingHistory(true);
    addLog(`🔍 Getting transaction history for wallet: ${resolvedWalletId.slice(0, 8)}... on chain ${selectedHistoryChain}`, 'info');

    try {
      // Ensure Railgun engine is ready (SAME AS WALLET PAGE)
      await waitForRailgunReady();
      addLog('✅ Railgun engine ready', 'success');

      // Check if we have encryption key for real SDK approach
      if (!encryptionKey) {
        addLog('❌ Cannot get transaction history: No encryption key available', 'error');
        addLog('💡 Transaction history requires the original encryption key to load wallet', 'info');
        return;
      }

      // Use the view-only wallet that was created earlier for transaction history
      if (!viewOnlyWallet) {
        addLog('❌ No view-only wallet available for transaction history', 'error');
        return;
      }

      console.log('[AdminHistoryPage] 📊 Using view-only wallet for transaction history:');
      console.log('[AdminHistoryPage] 🆔 View-only wallet ID:', viewOnlyWallet.id.slice(0, 8));
      console.log('[AdminHistoryPage] 🚀 View-only railgun address:', viewOnlyWallet.railgunAddress.slice(0, 10));

      addLog(`✅ Using view-only wallet for history: ${viewOnlyWallet.id.slice(0, 8)}...`, 'success');

      // View-only wallet is already loaded in createViewOnlyWallet function
      console.log('[AdminHistoryPage] ✅ View-only wallet already loaded for history');

      // Get transaction history using the view-only wallet ID we just created
      const history = await getTransactionHistory(viewOnlyWallet.id, selectedHistoryChain);

      setTransactionHistory(history);
      addLog(`✅ Retrieved ${history.length} transactions`, 'success');

      if (history.length > 0) {
        const latestTx = history[0];
        addLog(`📅 Latest transaction: ${latestTx.transactionType} at ${latestTx.date?.toLocaleString()}`, 'info');
      }

    } catch (error) {
      addLog(`❌ History retrieval failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] History retrieval error:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Auto-load view-only wallet only when wallet ID and encryption key are available
  // (encryption key + wallet ID are required to load existing wallet as view-only)
  useEffect(() => {
    if (resolvedWalletId && encryptionKey && !viewOnlyWallet && !isLoadingViewOnly) {
      loadViewOnlyWallet();
    }
  }, [resolvedWalletId, encryptionKey, viewOnlyWallet, isLoadingViewOnly]);

  // Cleanup: Unload wallets when component unmounts
  useEffect(() => {
    return () => {
      // Unload resolved wallet if loaded
      if (resolvedWalletId) {
        unloadWallet(resolvedWalletId).catch(error =>
          console.warn('[AdminHistoryPage] Failed to unload resolved wallet on unmount:', error)
        );
      }

      // Also unload view-only wallet if it exists
      if (viewOnlyWallet?.id) {
        unloadWallet(viewOnlyWallet.id).catch(error =>
          console.warn('[AdminHistoryPage] Failed to unload view-only wallet on unmount:', error)
        );
      }
    };
  }, [resolvedWalletId, viewOnlyWallet?.id]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-blue-400 mb-2">Admin Dashboard</h1>
          <p className="text-gray-400">Create view-only wallets using existing Railgun infrastructure</p>
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


        {/* View-Only Wallet Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">📥 Load View-Only Wallet</h2>

          {/* View-Only Wallet Loading Status */}
          {isLoadingViewOnly && (
            <div className="mb-4 p-3 bg-blue-900/30 border border-blue-600 rounded-md">
              <p className="text-blue-400">📥 Loading existing wallet as view-only...</p>
            </div>
          )}

          {/* View-Only Wallet Results */}
          {viewOnlyWallet && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ View-Only Wallet Loaded</h3>
              <div className="space-y-2 text-sm text-gray-300">
                <p><strong>Wallet ID:</strong> {viewOnlyWallet.id}</p>
                <p><strong>Railgun Address:</strong> {viewOnlyWallet.railgunAddress}</p>
                <p><strong>Type:</strong> View-Only</p>
              </div>
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
                  ⚠️ Cannot create view-only wallet: Failed to derive local encryption key.
                  <br />
                  <span className="text-sm text-yellow-300">View-only wallets require a valid local encryption key derived from wallet data.</span>
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