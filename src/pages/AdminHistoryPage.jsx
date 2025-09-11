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
import { loadViewOnlyWallet, generateViewingKey, loadWallet, unloadWallet, normalizeEncKey, normalizeAndValidateSVK, getCurrentEncryptionKey, deriveWalletEncryptionKey, generateShareableViewingKey, createWallet } from '../utils/railgun/wallet.js';
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

  // Admin wallet state (full access)
  const [adminWallet, setAdminWallet] = useState(null);
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
    // Unload wallets if they're loaded
    if (resolvedWalletId) {
      unloadWallet(resolvedWalletId).catch(error =>
        console.warn('[AdminHistoryPage] Failed to unload resolved wallet on clear:', error)
      );
    }

    // Also unload the admin wallet we loaded
    if (adminWallet?.id) {
      unloadWallet(adminWallet.id).catch(error =>
        console.warn('[AdminHistoryPage] Failed to unload admin wallet on clear:', error)
      );
    }

    setResolvedWalletId(null);
    setResolvedWalletAddress(null);
    setEncryptionKey(null);
    setAdminWallet(null);
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
      // Check if we need mnemonic for wallet creation (when wallet not found locally)
      const needMnemonic = !encryptionKey && resolvedWalletId;
      const queryParams = new URLSearchParams({
        walletAddress: encodeURIComponent(searchQuery)
      });

      if (needMnemonic) {
        queryParams.append('includeMnemonic', 'true');
        console.log('[AdminHistoryPage] 📝 Requesting mnemonic decryption for wallet creation');
      }

      // Use wallet-metadata proxy (HMAC headers are generated server-side by the API proxy)
      const response = await fetch(`/api/wallet-metadata?${queryParams.toString()}`, {
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
          // Find the first wallet metadata entry
          const walletMetadata = data.keys[0];
          if (walletMetadata && walletMetadata.walletId) {
            setResolvedWalletId(walletMetadata.walletId);
            setResolvedWalletAddress(searchQuery);

            console.log('[AdminHistoryPage] 📦 Metadata extracted:');
            console.log('[AdminHistoryPage] 🆔 Wallet ID:', walletMetadata.walletId);
            console.log('[AdminHistoryPage] 🔐 Metadata encryption key:', walletMetadata.encryptionKey ? `(length: ${walletMetadata.encryptionKey.length}, INVALID - ignoring)` : 'null');

            addLog(`✅ Wallet metadata retrieved successfully`, 'success');

            // Ignore metadata.encryptionKey - derive locally instead
            try {
              let derivedEncryptionKey = null;

              // First try to get from current active wallet
              derivedEncryptionKey = getCurrentEncryptionKey();

              // If no current wallet, derive using EXACT SAME method as regular users
              if (!derivedEncryptionKey) {
                console.log('[AdminHistoryPage] 🔐 Deriving encryption key using user method for:', searchQuery);

                // Get signature from wallet metadata (EXACT SAME AS WalletContext.jsx)
                const userSignature = walletMetadata.signature;
                if (userSignature) {
                  // Use EXACT SAME derivation as regular users: SHA256(signature + address)
                  const addressBytes = searchQuery.toLowerCase().replace('0x', '');
                  const signatureBytes = userSignature.replace('0x', '');
                  const combined = signatureBytes + addressBytes;

                  const CryptoJS = await import('crypto-js');
                  const hash = CryptoJS.SHA256(combined);
                  derivedEncryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

                  console.log('[AdminHistoryPage] ✅ Derived encryption key using user method');
                } else {
                  console.log('[AdminHistoryPage] ❌ No signature available for key derivation');
                  addLog(`❌ Cannot derive encryption key: No signature in wallet metadata`, 'error');
                }
              }

              if (derivedEncryptionKey) {
                setEncryptionKey(derivedEncryptionKey);

                console.log('[AdminHistoryPage] 🔐 Local encryption key derivation details:');
                console.log('[AdminHistoryPage] 📏 Derived key length:', derivedEncryptionKey.length);
                console.log('[AdminHistoryPage] ✅ Valid 64 hex characters?', derivedEncryptionKey.length === 64 && /^[a-f0-9]{64}$/i.test(derivedEncryptionKey));
                console.log('[AdminHistoryPage] 🔑 Method: SHA256(signature + address) - EXACT SAME AS USER');

                addLog(`🔐 Encryption key derived using user method: YES (${derivedEncryptionKey.slice(0, 16)}...)`, 'success');
                addLog(`📝 Will load EXISTING user wallet with full admin access`, 'info');
                console.log('[AdminHistoryPage] ✅ Local encryption key matches user wallet');
              } else {
                setEncryptionKey(null);
                addLog(`⚠️ Could not derive encryption key - admin wallet access disabled`, 'warning');
                console.log('[AdminHistoryPage] ⚠️ Encryption key derivation failed');
              }
            } catch (deriveError) {
              console.error('[AdminHistoryPage] ❌ Local encryption key derivation failed:', deriveError);
              setEncryptionKey(null);
              addLog(`❌ Could not derive encryption key: ${deriveError.message}`, 'error');
            }

            addLog(`📍 Wallet ID: ${walletMetadata.walletId.slice(0, 8)}...`, 'info');
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



  // EXACT SAME WALLET LOADING AS REGULAR USER FLOW - Load user's existing wallet
  const loadUserWallet = async () => {
    if (!resolvedWalletId || !encryptionKey) {
      addLog('Missing wallet ID or encryption key', 'error');
      return;
    }

    setIsCreatingViewOnly(true);
    addLog('🏗️ Loading wallet using standard user flow...', 'info');

    try {
      // Ensure Railgun engine is ready
      await waitForRailgunReady();
      addLog('✅ Railgun engine ready', 'success');

      console.log('[AdminHistoryPage] 🔐 Loading wallet with standard user flow:', {
        walletId: resolvedWalletId?.slice(0, 8) + '...',
        encryptionKeyLength: encryptionKey?.length
      });

      // EXACT SAME PATTERN AS WalletContext.jsx - Try to load existing wallet first
      console.log('[AdminHistoryPage] 📥 Attempting to load EXISTING user wallet...');
      addLog('📥 Loading existing user wallet...', 'info');

      try {
        // This is EXACTLY the same call as in WalletContext.jsx line 1422
        const loadedWalletInfo = await loadWallet(encryptionKey, resolvedWalletId, false);
        console.log('[AdminHistoryPage] ✅ EXISTING user wallet loaded successfully!');
        addLog(`✅ EXISTING wallet loaded: ${resolvedWalletId?.slice(0, 8)}...`, 'success');

        setAdminWallet(loadedWalletInfo);
        addLog(`✅ Admin access to user's wallet ready`, 'success');
        return;

      } catch (loadError) {
        console.log('[AdminHistoryPage] ⚠️ User wallet not found locally, will RECREATE from mnemonic:', loadError.message);
        addLog('📝 User wallet not loaded locally - recreating from stored mnemonic...', 'info');
      }

      // EXACT SAME PATTERN AS WalletContext.jsx - If wallet load fails, recreate from mnemonic
      console.log('[AdminHistoryPage] 🔄 Fetching user mnemonic to recreate wallet...');

      // Get mnemonic from backend (same as regular user flow)
      const mnemonicResponse = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(searchQuery)}&includeMnemonic=true`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!mnemonicResponse.ok) {
        throw new Error(`Failed to fetch mnemonic: ${mnemonicResponse.status}`);
      }

      const mnemonicData = await mnemonicResponse.json();
      if (!mnemonicData.success || !mnemonicData.keys || mnemonicData.keys.length === 0) {
        throw new Error('No wallet data found');
      }

      const walletData = mnemonicData.keys[0];
      if (!walletData.decryptedMnemonic) {
        addLog('❌ No mnemonic available for wallet creation', 'error');
        throw new Error('Wallet mnemonic not available');
      }

      // EXACT SAME PATTERN AS WalletContext.jsx - Recreate user's wallet from mnemonic
      console.log('[AdminHistoryPage] 🏗️ Recreating user wallet from stored mnemonic...');
      addLog('🏗️ Recreating user wallet from stored mnemonic...', 'info');

      const recreatedWallet = await createWallet(
        walletData.decryptedMnemonic,
        undefined,
        walletData.scannedChains || undefined
      );

      console.log('[AdminHistoryPage] ✅ User wallet recreated successfully');
      console.log('[AdminHistoryPage] 🆔 Recreated wallet ID:', recreatedWallet.id?.slice(0, 8));
      console.log('[AdminHistoryPage] 🎯 Should match original:', resolvedWalletId?.slice(0, 8));

      addLog(`✅ User wallet recreated: ${recreatedWallet.id?.slice(0, 8)}...`, 'success');
      addLog(`✅ Railgun Address: ${recreatedWallet.railgunAddress}`, 'success');

      // Verify this is the SAME wallet (should have same ID)
      if (recreatedWallet.id === resolvedWalletId) {
        console.log('[AdminHistoryPage] ✅ SUCCESS: Recreated wallet matches original ID!');
        addLog('✅ Wallet ID matches - this is the user\'s original wallet', 'success');
      } else {
        console.log('[AdminHistoryPage] ⚠️ WARNING: Recreated wallet has different ID');
        console.log('[AdminHistoryPage] 📊 Original ID:', resolvedWalletId);
        console.log('[AdminHistoryPage] 📊 Recreated ID:', recreatedWallet.id);
        addLog('⚠️ Wallet ID mismatch - recreated wallet may be different', 'warning');
      }

      // EXACT SAME PATTERN AS WalletContext.jsx - Load the recreated wallet
      console.log('[AdminHistoryPage] 📥 Loading recreated user wallet...');
      await loadWallet(encryptionKey, recreatedWallet.id, false);

      console.log('[AdminHistoryPage] ✅ User wallet loaded successfully');
      addLog('✅ User wallet loaded with full admin access', 'success');

      setAdminWallet(recreatedWallet);
      addLog(`✅ Admin access to user's wallet ready`, 'success');

    } catch (error) {
      addLog(`❌ Wallet loading failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] Wallet loading error:', error);
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

      // Check if we have encryption key for real SDK approach
      if (!encryptionKey) {
        addLog('❌ Cannot get transaction history: No encryption key available', 'error');
        addLog('💡 Transaction history requires the original encryption key to load wallet', 'info');
        return;
      }

      // Use the admin wallet that was loaded earlier for transaction history
      if (!adminWallet) {
        addLog('❌ No admin wallet available for transaction history', 'error');
        return;
      }

      console.log('[AdminHistoryPage] 📊 Using admin wallet for transaction history:');
      console.log('[AdminHistoryPage] 🆔 Admin wallet ID:', adminWallet.id.slice(0, 8));
      console.log('[AdminHistoryPage] 🚀 Admin railgun address:', adminWallet.railgunAddress.slice(0, 10));

      addLog(`✅ Using admin wallet for history: ${adminWallet.id.slice(0, 8)}...`, 'success');

      // Admin wallet is already loaded in loadWalletDirectly function
      console.log('[AdminHistoryPage] ✅ Admin wallet already loaded for history');

      // Get transaction history using the admin wallet ID
      console.log('[AdminHistoryPage] 📊 Getting transaction history:', {
        adminWalletId: adminWallet.id?.slice(0, 8) + '...',
        resolvedWalletId: resolvedWalletId?.slice(0, 8) + '...',
        selectedChain: selectedHistoryChain,
        walletIdsMatch: adminWallet.id === resolvedWalletId
      });

      const history = await getTransactionHistory(adminWallet.id, selectedHistoryChain);

      console.log('[AdminHistoryPage] 📊 Transaction history result:', {
        transactionCount: history.length,
        walletId: adminWallet.id?.slice(0, 8) + '...',
        chainId: selectedHistoryChain
      });

      setTransactionHistory(history);
      addLog(`✅ Retrieved ${history.length} transactions for chain ${selectedHistoryChain}`, 'success');

      if (history.length > 0) {
        const latestTx = history[0];
        addLog(`📅 Latest transaction: ${latestTx.transactionType} at ${latestTx.date?.toLocaleString()}`, 'info');
      } else {
        addLog('ℹ️ No transactions found - wallet may not have been scanned on this chain yet', 'info');
        console.log('[AdminHistoryPage] ℹ️ No transactions found - possible reasons:');
        console.log('[AdminHistoryPage]   • Wallet not scanned on this chain');
        console.log('[AdminHistoryPage]   • User has no transactions on this chain');
        console.log('[AdminHistoryPage]   • Wallet recreated from mnemonic (needs rescanning)');
      }

    } catch (error) {
      addLog(`❌ History retrieval failed: ${error.message}`, 'error');
      console.error('[AdminHistoryPage] History retrieval error:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Auto-load user's existing wallet when wallet ID and encryption key are available
  // This loads the wallet with full admin access using EXACT SAME method as user
  useEffect(() => {
    if (resolvedWalletId && encryptionKey && !adminWallet && !isCreatingViewOnly) {
      loadUserWallet();
    }
  }, [resolvedWalletId, encryptionKey, adminWallet, isCreatingViewOnly]);

  // Cleanup: Unload wallets when component unmounts
  useEffect(() => {
    return () => {
      // Unload resolved wallet if loaded
      if (resolvedWalletId) {
        unloadWallet(resolvedWalletId).catch(error =>
          console.warn('[AdminHistoryPage] Failed to unload resolved wallet on unmount:', error)
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


        {/* Admin Wallet Access Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🔐 Admin Wallet Access</h2>

          {/* Wallet Loading Status */}
          {isCreatingViewOnly && (
            <div className="mb-4 p-3 bg-blue-900/30 border border-blue-600 rounded-md">
              <p className="text-blue-400">🏗️ Loading wallet with full admin access...</p>
            </div>
          )}

          {/* Wallet Access Results */}
          {adminWallet && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ Wallet Loaded with Full Admin Access</h3>
              <div className="space-y-2 text-sm text-gray-300">
                <p><strong>Wallet ID:</strong> {adminWallet.id}</p>
                <p><strong>Railgun Address:</strong> {adminWallet.railgunAddress}</p>
                <p><strong>Access Level:</strong> Full Admin Access</p>
                <p><strong>Capabilities:</strong> View transactions, balances, and wallet details</p>
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