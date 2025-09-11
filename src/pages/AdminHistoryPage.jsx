/**
 * Admin Dashboard - View-Only Wallet Creation
 *
 * BRAND NEW FILE - Not based on any existing admin dashboard code
 *
 * Features:
 * 1. Search for user's viewing key using existing wallet-metadata routes
 * 2. Create view-only wallet using retrieved viewing key
 * 3. Follow Railgun documentation for encryption keys and view-only wallets
 * 4. Comprehensive logging for each step
 */

import React, { useState, useEffect } from 'react';
import { loadViewOnlyWallet, generateViewingKey, loadWallet, unloadWallet } from '../utils/railgun/wallet.js';
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
  const [viewingKey, setViewingKey] = useState(null);
  const [encryptionKey, setEncryptionKey] = useState(null);

  // View-only wallet state
  const [viewOnlyWallet, setViewOnlyWallet] = useState(null);
  const [isCreatingViewOnly, setIsCreatingViewOnly] = useState(false);

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
    // Unload wallet if it's loaded
    if (resolvedWalletId) {
      unloadWallet(resolvedWalletId).catch(error =>
        console.warn('[AdminHistoryPage] Failed to unload wallet on clear:', error)
      );
    }

    setResolvedWalletId(null);
    setResolutionType(null);
    setResolvedWalletAddress(null);
    setViewingKey(null);
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
      // Use wallet-metadata proxy with proper query parameters
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(searchQuery)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.keys && data.keys.length > 0) {
        // Find the key with viewing key
        const keyWithViewingKey = data.keys.find(key => key.viewingKey);
        if (keyWithViewingKey) {
          setResolvedWalletId(keyWithViewingKey.walletId);
          setResolvedWalletAddress(searchQuery);
          setViewingKey(keyWithViewingKey.viewingKey);
          setEncryptionKey(keyWithViewingKey.encryptionKey);
          addLog(`✅ Wallet metadata retrieved successfully`, 'success');
          addLog(`🔑 Viewing key found: ${keyWithViewingKey.viewingKey.slice(0, 20)}...`, 'success');
          addLog(`🔐 Encryption key found: ${keyWithViewingKey.encryptionKey ? 'YES' : 'NO'}`, 'success');
          addLog(`📍 Wallet ID: ${keyWithViewingKey.walletId.slice(0, 8)}...`, 'info');
        } else {
          throw new Error('No viewing key found in wallet metadata');
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



  // Create view-only wallet using EXACT SAME INTEGRATION AS WORKING SDK
  const createViewOnlyWallet = async () => {
    if (!resolvedWalletId || !encryptionKey) {
      addLog('Missing wallet ID or encryption key for view-only wallet creation', 'error');
      return;
    }

    setIsCreatingViewOnly(true);
    addLog('🏗️ Creating view-only wallet...', 'info');

    try {
      // Ensure Railgun engine is ready (SAME AS WORKING SDK)
      await waitForRailgunReady();
      addLog('✅ Railgun engine ready', 'success');

      // STEP 1: Load the wallet using encryption key (SAME AS WORKING SDK)
      console.log('[AdminHistoryPage] Loading wallet with:', {
        walletId: resolvedWalletId?.slice(0, 8),
        hasEncryptionKey: !!encryptionKey
      });

      const loadedWallet = await loadWallet(resolvedWalletId, encryptionKey);
      addLog(`✅ Wallet loaded: ${loadedWallet.id.slice(0, 8)}...`, 'success');

      // STEP 2: Generate viewing key using REAL SDK method (SAME AS WORKING SDK)
      const realViewingKey = await generateViewingKey(resolvedWalletId);
      addLog(`🔑 Generated real viewing key: ${realViewingKey.slice(0, 20)}...`, 'success');

      // STEP 3: Create view-only wallet using real viewing key (SAME AS WORKING SDK)
      console.log('[AdminHistoryPage] Creating view-only wallet with real viewing key:', {
        viewingKeyLength: realViewingKey?.length,
        viewingKeyPrefix: realViewingKey?.substring(0, 16)
      });

      const viewOnlyWalletInfo = await loadViewOnlyWallet(
        realViewingKey,
        undefined // creationBlockNumber - SAME AS WORKING SDK
      );

      setViewOnlyWallet(viewOnlyWalletInfo);
      addLog(`✅ View-only wallet created successfully: ${viewOnlyWalletInfo.id.slice(0, 8)}...`, 'success');
      addLog(`✅ Railgun Address: ${viewOnlyWalletInfo.railgunAddress}`, 'success');

      // IMPORTANT: Keep the original wallet loaded for transaction history!
      // Do NOT unload it here - let it stay loaded for the history feature
      addLog(`🔄 Keeping original wallet loaded for transaction history access`, 'info');

    } catch (error) {
      addLog(`❌ View-only wallet creation failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] View-only wallet creation error:', error);
    } finally {
      setIsCreatingViewOnly(false);
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

      // Get transaction history using official SDK (SAME AS WALLET PAGE)
      const history = await getTransactionHistory(resolvedWalletId, selectedHistoryChain);

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

  // Auto-create view-only wallet when wallet ID and encryption key are available
  useEffect(() => {
    if (resolvedWalletId && encryptionKey && !viewOnlyWallet && !isCreatingViewOnly) {
      createViewOnlyWallet();
    }
  }, [resolvedWalletId, encryptionKey, viewOnlyWallet, isCreatingViewOnly]);

  // Cleanup: Unload wallet when component unmounts
  useEffect(() => {
    return () => {
      if (resolvedWalletId) {
        unloadWallet(resolvedWalletId).catch(error =>
          console.warn('[AdminHistoryPage] Failed to unload wallet on unmount:', error)
        );
      }
    };
  }, [resolvedWalletId]);

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
              {viewingKey && (
                <p className="text-sm text-gray-300 break-all">
                  <strong>Viewing Key:</strong> {viewingKey.slice(0, 20)}...
                </p>
              )}
            </div>
          )}
        </div>


        {/* View-Only Wallet Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🏗️ Create View-Only Wallet</h2>

          {/* View-Only Wallet Creation Status */}
          {isCreatingViewOnly && (
            <div className="mb-4 p-3 bg-blue-900/30 border border-blue-600 rounded-md">
              <p className="text-blue-400">🏗️ Creating view-only wallet...</p>
            </div>
          )}

          {/* View-Only Wallet Results */}
          {viewOnlyWallet && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ View-Only Wallet Created</h3>
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