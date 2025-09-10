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
import { loadViewOnlyWallet, deriveEncryptionKey } from '../utils/railgun/wallet.js';
import { waitForRailgunReady } from '../utils/railgun/engine.js';

const AdminDashboard = () => {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('zkaddress'); // 'zkaddress', 'eoa', 'txhash'
  const [isSearching, setIsSearching] = useState(false);

  // Resolution state
  const [resolvedWalletId, setResolvedWalletId] = useState(null);
  const [resolutionType, setResolutionType] = useState(null);

  // Viewing key state
  const [viewingKey, setViewingKey] = useState(null);
  const [isLoadingViewingKey, setIsLoadingViewingKey] = useState(false);

  // View-only wallet state
  const [viewOnlyWallet, setViewOnlyWallet] = useState(null);
  const [isCreatingViewOnly, setIsCreatingViewOnly] = useState(false);

  // Encryption key state (for view-only wallet creation)
  const [encryptionKey, setEncryptionKey] = useState(null);

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
    setResolvedWalletId(null);
    setResolutionType(null);
    setViewingKey(null);
    setViewOnlyWallet(null);
    setEncryptionKey(null);
    setLogs([]);
    addLog('Dashboard cleared', 'info');
  };

  // Step 1: Resolve wallet identifier to walletId
  const resolveWallet = async () => {
    if (!searchQuery.trim()) {
      addLog('Search query is empty', 'error');
      return;
    }

    setIsSearching(true);
    addLog(`🔍 Starting wallet resolution for: ${searchQuery} (type: ${searchType})`, 'info');

    try {
      // Use existing wallet-metadata proxy endpoint
      const response = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(searchQuery)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.walletId) {
        setResolvedWalletId(data.walletId);
        setResolutionType(data.resolutionType);
        addLog(`✅ Wallet resolved successfully: ${data.walletId.slice(0, 8)}... (type: ${data.resolutionType})`, 'success');
      } else {
        throw new Error(data.error || 'Resolution failed');
      }

    } catch (error) {
      addLog(`❌ Wallet resolution failed: ${error.message}`, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // Step 2: Get viewing key using resolved walletId
  const getViewingKey = async () => {
    if (!resolvedWalletId) {
      addLog('No wallet ID available for viewing key retrieval', 'error');
      return;
    }

    setIsLoadingViewingKey(true);
    addLog(`🔑 Retrieving viewing key for wallet: ${resolvedWalletId.slice(0, 8)}...`, 'info');

    try {
      // Use existing viewing-key-get endpoint
      const response = await fetch(`/api/wallet-metadata?action=viewing-key-get&walletId=${encodeURIComponent(resolvedWalletId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success && data.viewingKey) {
        setViewingKey(data.viewingKey);
        addLog(`✅ Viewing key retrieved successfully: ${data.viewingKey.slice(0, 20)}...`, 'success');
      } else {
        throw new Error(data.error || 'Viewing key retrieval failed');
      }

    } catch (error) {
      addLog(`❌ Viewing key retrieval failed: ${error.message}`, 'error');
    } finally {
      setIsLoadingViewingKey(false);
    }
  };

  // Step 3: Generate encryption key for view-only wallet
  const generateEncryptionKey = async () => {
    addLog('🔐 Generating encryption key for view-only wallet creation...', 'info');

    try {
      // Following Railgun docs: Use a 32-byte hex string for encryption key
      // Generate a random 32-byte key (64 hex characters)
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);

      // Convert to hex string
      const keyHex = Array.from(randomBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');

      setEncryptionKey(keyHex);
      addLog(`✅ Encryption key generated: ${keyHex.slice(0, 16)}...`, 'success');

    } catch (error) {
      addLog(`❌ Encryption key generation failed: ${error.message}`, 'error');
    }
  };

  // Step 4: Create view-only wallet using viewing key
  const createViewOnlyWallet = async () => {
    if (!viewingKey || !encryptionKey) {
      addLog('Missing viewing key or encryption key for view-only wallet creation', 'error');
      return;
    }

    setIsCreatingViewOnly(true);
    addLog('🏗️ Creating view-only wallet...', 'info');

    try {
      // Ensure Railgun engine is ready
      await waitForRailgunReady();
      addLog('✅ Railgun engine ready', 'success');

      // Following Railgun docs: Use createViewOnlyRailgunWallet with shareable viewing key
      // For creation block numbers, we'll use undefined as per docs example
      const creationBlockNumberMap = undefined;

      // Import the function from Railgun SDK
      const { createViewOnlyRailgunWallet } = await import('@railgun-community/wallet');

      const viewOnlyWalletInfo = await createViewOnlyRailgunWallet(
        encryptionKey,
        viewingKey,
        creationBlockNumberMap
      );

      setViewOnlyWallet(viewOnlyWalletInfo);
      addLog(`✅ View-only wallet created successfully: ${viewOnlyWalletInfo.id.slice(0, 8)}...`, 'success');
      addLog(`✅ Railgun Address: ${viewOnlyWalletInfo.railgunAddress}`, 'success');

    } catch (error) {
      addLog(`❌ View-only wallet creation failed: ${error.message}`, 'error');
    } finally {
      setIsCreatingViewOnly(false);
    }
  };

  // Auto-generate encryption key when viewing key is retrieved
  useEffect(() => {
    if (viewingKey && !encryptionKey) {
      generateEncryptionKey();
    }
  }, [viewingKey, encryptionKey]);

  // Auto-create view-only wallet when both viewing key and encryption key are available
  useEffect(() => {
    if (viewingKey && encryptionKey && !viewOnlyWallet) {
      createViewOnlyWallet();
    }
  }, [viewingKey, encryptionKey, viewOnlyWallet]);

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
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🔍 Step 1: Search Wallet</h2>

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
                onClick={resolveWallet}
                disabled={isSearching || !searchQuery.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                {isSearching ? '🔍 Searching...' : '🔍 Resolve Wallet'}
              </button>

              <button
                onClick={clearState}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md transition-colors"
              >
                🗑️ Clear
              </button>
            </div>
          </div>

          {/* Resolution Results */}
          {resolvedWalletId && (
            <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-md">
              <h3 className="text-green-400 font-medium mb-2">✅ Wallet Resolved</h3>
              <p className="text-sm text-gray-300">
                <strong>Wallet ID:</strong> {resolvedWalletId}
              </p>
              <p className="text-sm text-gray-300">
                <strong>Resolution Type:</strong> {resolutionType}
              </p>
            </div>
          )}
        </div>

        {/* Viewing Key Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🔑 Step 2: Get Viewing Key</h2>

          <div className="space-y-4">
            <button
              onClick={getViewingKey}
              disabled={!resolvedWalletId || isLoadingViewingKey}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              {isLoadingViewingKey ? '🔄 Loading...' : '🔑 Get Viewing Key'}
            </button>
          </div>

          {/* Viewing Key Results */}
          {viewingKey && (
            <div className="mt-4 p-3 bg-purple-900/30 border border-purple-600 rounded-md">
              <h3 className="text-purple-400 font-medium mb-2">✅ Viewing Key Retrieved</h3>
              <p className="text-sm text-gray-300 break-all">
                <strong>Viewing Key:</strong> {viewingKey}
              </p>
            </div>
          )}
        </div>

        {/* View-Only Wallet Section */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4 text-blue-300">🏗️ Step 3: Create View-Only Wallet</h2>

          {/* Encryption Key Status */}
          {encryptionKey && (
            <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-600 rounded-md">
              <h3 className="text-yellow-400 font-medium mb-2">🔐 Encryption Key Generated</h3>
              <p className="text-sm text-gray-300 break-all">
                <strong>Key:</strong> {encryptionKey}
              </p>
            </div>
          )}

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