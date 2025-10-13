/**
 * Admin History Dashboard
 *
 * Clean implementation using existing backend endpoints:
 * 1. Resolve identifiers to wallet IDs
 * 2. Fetch transaction history from Redis
 * 3. Display results in admin dashboard
 */

import React, { useState, useEffect, useCallback } from 'react';
import { getAddress } from 'ethers';

const AdminDashboard = () => {
  // Password authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');

  // Check if user is already authenticated on component mount
  useEffect(() => {
    const authStatus = localStorage.getItem('admin_authenticated');
    if (authStatus === 'true') {
      setIsAuthenticated(true);
    }
  }, []);

  // Handle password authentication
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setIsAuthenticating(true);
    setAuthError('');

    try {
      // Call wallet-metadata proxy to verify password
      const response = await fetch('/api/wallet-metadata?action=verify-admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        },
        body: JSON.stringify({ password })
      });

      const result = await response.json();

      if (result.success) {
        setIsAuthenticated(true);
        localStorage.setItem('admin_authenticated', 'true');
        setPassword('');
      } else {
        setAuthError('Invalid password');
      }
    } catch (error) {
      console.error('Password verification error:', error);
      setAuthError('Authentication failed. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem('admin_authenticated');
    setPassword('');
    setAuthError('');
  };

  // Main admin interface hooks (must be called before any conditionals)
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState('eoa'); // 'eoa', 'railgun', 'txhash'
  const [isSearching, setIsSearching] = useState(false);

  // Results state
  const [walletId, setWalletId] = useState(null);
  const [resolutionType, setResolutionType] = useState(null);
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedChain, setSelectedChain] = useState(1); // Default to Ethereum

  // UI state
  const [logs, setLogs] = useState([]);

  // Tab management
  const [activeTab, setActiveTab] = useState('compliance'); // 'compliance', 'points', or 'access-codes'

  // Points tab state
  const [pointsData, setPointsData] = useState([]);
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);
  const [pointsSortBy, setPointsSortBy] = useState('lexieId'); // 'lexieId' or 'points'
  const [pointsSortOrder, setPointsSortOrder] = useState('asc'); // 'asc' or 'desc'

  // Analytics tab state
  const [analyticsData, setAnalyticsData] = useState(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsPeriod, setAnalyticsPeriod] = useState('all'); // 'all', '24h', '7d', '30d', '90d', 'custom'
  const [analyticsStartDate, setAnalyticsStartDate] = useState('');
  const [analyticsEndDate, setAnalyticsEndDate] = useState('');

  // Access codes tab state
  const [accessCodesData, setAccessCodesData] = useState([]);
  const [isLoadingAccessCodes, setIsLoadingAccessCodes] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState('');
  const [isCreatingCode, setIsCreatingCode] = useState(false);
  const [accessCodesStats, setAccessCodesStats] = useState(null);

  // Add log entry - memoized to prevent infinite re-renders
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      message,
      type
    };
    setLogs(prev => [...prev, logEntry]);
    console.log(`[${type.toUpperCase()}] ${message}`);
  }, []);

  // Log when dashboard is cleared
  useEffect(() => {
    if (walletId === null && resolutionType === null && transactionHistory.length === 0) {
      addLog('Dashboard cleared', 'info');
    }
  }, [walletId, resolutionType, transactionHistory.length, addLog]);

  // Load points data for Points tab
  const loadPointsData = async () => {
    setIsLoadingPoints(true);
    addLog('📊 Loading points data...', 'info');

    try {
      const pointsParams = new URLSearchParams({
        action: 'get-all-points'
      });

      const pointsResponse = await fetch(`/api/wallet-metadata?${pointsParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!pointsResponse.ok) {
        throw new Error(`Points data fetch failed: ${pointsResponse.status}`);
      }

      const pointsResult = await pointsResponse.json();

      if (pointsResult.success) {
        const data = pointsResult.points || [];
        setPointsData(data);
        addLog(`✅ Loaded ${data.length} users with points`, 'success');
      } else {
        addLog(`❌ Failed to load points data: ${pointsResult.error || 'Unknown error'}`, 'error');
      }

    } catch (error) {
      addLog(`❌ Points data loading failed: ${error.message}`, 'error');
      console.error('Points data loading error:', error);
    } finally {
      setIsLoadingPoints(false);
    }
  };

  // Sort points data
  const getSortedPointsData = () => {
    return [...pointsData].sort((a, b) => {
      let aValue, bValue;

      if (pointsSortBy === 'lexieId') {
        aValue = a.lexieId?.toLowerCase() || '';
        bValue = b.lexieId?.toLowerCase() || '';
      } else if (pointsSortBy === 'points') {
        aValue = a.points || 0;
        bValue = b.points || 0;
      }

      if (pointsSortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  };

  // Export points data to CSV
  const exportPointsToCSV = () => {
    if (!pointsData.length) {
      addLog('No points data to export', 'error');
      return;
    }

    try {
      const sortedData = getSortedPointsData();

      // CSV headers
      const headers = ['LexieID', 'EOA Address', 'Railgun Address', 'Total Points'];

      // Convert data to CSV rows
      const csvRows = sortedData.map(user => [
        user.lexieId || '',
        user.eoaAddress || '',
        user.walletAddress || '',
        user.points || 0
      ]);

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `lexie-points-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addLog(`CSV export completed: ${pointsData.length} users`, 'success');
    } catch (error) {
      console.error('Failed to export points CSV:', error);
      addLog('Failed to export points CSV', 'error');
    }
  };

  // Load analytics data
  const loadAnalyticsData = async () => {
    setIsLoadingAnalytics(true);
    addLog('📊 Loading analytics data...', 'info');

    try {
      const analyticsParams = new URLSearchParams({
        action: 'get-analytics'
      });

      // Add time filters if selected
      if (analyticsPeriod !== 'all') {
        if (analyticsPeriod === 'custom') {
          if (analyticsStartDate) analyticsParams.append('startDate', analyticsStartDate);
          if (analyticsEndDate) analyticsParams.append('endDate', analyticsEndDate);
        } else {
          analyticsParams.append('period', analyticsPeriod);
        }
      }

      const analyticsResponse = await fetch(`/api/wallet-metadata?${analyticsParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!analyticsResponse.ok) {
        throw new Error(`Analytics data fetch failed: ${analyticsResponse.status}`);
      }

      const analyticsResult = await analyticsResponse.json();

      if (analyticsResult.success) {
        setAnalyticsData(analyticsResult.analytics);
        const periodText = analyticsPeriod === 'all' ? 'all time' : analyticsPeriod;
        addLog(`✅ Analytics data loaded successfully (${periodText})`, 'success');
      } else {
        addLog(`❌ Failed to load analytics data: ${analyticsResult.error || 'Unknown error'}`, 'error');
      }

    } catch (error) {
      addLog(`❌ Analytics data loading failed: ${error.message}`, 'error');
      console.error('Analytics data loading error:', error);
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  // Load points data when Points tab is selected
  useEffect(() => {
    if (activeTab === 'points' && pointsData.length === 0 && !isLoadingPoints) {
      loadPointsData();
    }
  }, [activeTab, pointsData.length, isLoadingPoints]);

  // Load analytics data when Analytics tab is selected
  useEffect(() => {
    if (activeTab === 'analytics' && !analyticsData && !isLoadingAnalytics) {
      loadAnalyticsData();
    }
  }, [activeTab, analyticsData, isLoadingAnalytics]);

  // Load access codes data for Access Codes tab
  const loadAccessCodesData = async () => {
    setIsLoadingAccessCodes(true);
    addLog('🔐 Loading access codes data...', 'info');

    try {
      // Load access codes list
      const codesResponse = await fetch('/api/access-codes?action=list-access-codes', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!codesResponse.ok) {
        throw new Error(`Access codes fetch failed: ${codesResponse.status}`);
      }

      const codesResult = await codesResponse.json();

      if (codesResult.success) {
        setAccessCodesData(codesResult.codes || []);
        addLog(`✅ Loaded ${codesResult.codes?.length || 0} access codes`, 'success');
      } else {
        addLog(`❌ Failed to load access codes: ${codesResult.error || 'Unknown error'}`, 'error');
      }

      // Load access codes stats
      const statsResponse = await fetch('/api/access-codes?action=get-access-code-stats', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (statsResponse.ok) {
        const statsResult = await statsResponse.json();
        if (statsResult.success) {
          setAccessCodesStats(statsResult.stats);
        }
      }

    } catch (error) {
      addLog(`❌ Access codes loading failed: ${error.message}`, 'error');
      console.error('Access codes loading error:', error);
    } finally {
      setIsLoadingAccessCodes(false);
    }
  };

  // Create new access code
  const createAccessCode = async () => {
    if (!newAccessCode.trim()) {
      addLog('Please enter an access code', 'error');
      return;
    }

    const code = newAccessCode.trim().toUpperCase();
    if (code.length < 3 || code.length > 15) {
      addLog('Access code must be 3-15 characters', 'error');
      return;
    }

    setIsCreatingCode(true);
    addLog(`🔐 Creating access code: ${code}`, 'info');

    try {
      const response = await fetch('/api/access-codes?action=create-access-code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        },
        body: JSON.stringify({
          code: code,
          createdBy: 'admin'
        })
      });

      const result = await response.json();

      if (result.success) {
        setNewAccessCode('');
        addLog(`✅ Access code "${code}" created successfully`, 'success');
        // Reload access codes data
        await loadAccessCodesData();
      } else {
        addLog(`❌ Failed to create access code: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      addLog(`❌ Access code creation failed: ${error.message}`, 'error');
      console.error('Access code creation error:', error);
    } finally {
      setIsCreatingCode(false);
    }
  };

  // Deactivate access code
  const deactivateAccessCode = async (codeId, code) => {
    if (!confirm(`Are you sure you want to deactivate access code "${code}"?`)) {
      return;
    }

    addLog(`🔒 Deactivating access code: ${code}`, 'info');

    try {
      const response = await fetch(`/api/access-codes?action=deactivate-access-code&codeId=${codeId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      const result = await response.json();

      if (result.success) {
        addLog(`✅ Access code "${code}" deactivated`, 'success');
        // Reload access codes data
        await loadAccessCodesData();
      } else {
        addLog(`❌ Failed to deactivate access code: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      addLog(`❌ Access code deactivation failed: ${error.message}`, 'error');
      console.error('Access code deactivation error:', error);
    }
  };

  // Load access codes data when Access Codes tab is selected
  useEffect(() => {
    if (activeTab === 'access-codes' && accessCodesData.length === 0 && !isLoadingAccessCodes) {
      loadAccessCodesData();
    }
  }, [activeTab, accessCodesData.length, isLoadingAccessCodes]);

  // Password authentication UI
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-lg p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-blue-400 mb-2">Admin Access Required</h1>
            <p className="text-gray-400">Enter the admin password to continue</p>
          </div>

          <form onSubmit={handlePasswordSubmit}>
            <div className="mb-6">
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 text-white"
                placeholder="Enter admin password"
                required
                autoFocus
              />
            </div>

            {authError && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-600 rounded-md">
                <p className="text-red-300 text-sm">{authError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isAuthenticating || !password.trim()}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md transition-colors font-medium"
            >
              {isAuthenticating ? 'Verifying...' : 'Access Admin Panel'}
            </button>
          </form>

          <div className="mt-6 text-center text-xs text-gray-500">
            This area is restricted to authorized administrators only.
          </div>
        </div>
      </div>
    );
  }


  // Handle Railgun address search
  const handleRailgunSearch = async (railgunAddress) => {
    try {
      // Step 1: Validate Railgun address format
      if (!railgunAddress.startsWith('0zk')) {
        addLog('❌ Invalid Railgun address format (must start with 0zk)', 'error');
        setIsSearching(false);
        return;
      }

      addLog(`🔍 Resolving Railgun address to wallet ID...`, 'info');

      // Step 2: Call the wallet-metadata proxy with resolve-wallet-id action
      const resolveParams = new URLSearchParams({
        action: 'resolve-wallet-id',
        type: 'by-railgun',
        identifier: railgunAddress
      });

      const resolveResponse = await fetch(`/api/wallet-metadata?${resolveParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!resolveResponse.ok) {
        if (resolveResponse.status === 404) {
          addLog(`❌ No wallet found for Railgun address: ${railgunAddress}`, 'error');
        } else {
          throw new Error(`Railgun resolution failed: ${resolveResponse.status}`);
        }
        setIsSearching(false);
        return;
      }

      const resolveData = await resolveResponse.json();

      if (!resolveData.success || !resolveData.walletId) {
        addLog(`❌ No wallet ID found for Railgun address: ${railgunAddress}`, 'error');
        setIsSearching(false);
        return;
      }

      const walletId = resolveData.walletId;
      setWalletId(walletId);
      setResolutionType('Railgun Address');

      addLog(`✅ Found wallet ID: ${walletId.slice(0, 8)}... from Railgun address`, 'success');

      // Step 3: Load transaction timeline
      await loadWalletTimeline(walletId);

    } catch (error) {
      addLog(`❌ Railgun search failed: ${error.message}`, 'error');
      console.error('Railgun search error:', error);
      setIsSearching(false);
    }
  };

  // Handle Transaction Hash search
  const handleTxHashSearch = async (txHash) => {
    try {
      // Step 1: Validate transaction hash format
      if (!txHash.startsWith('0x') || txHash.length < 66) {
        addLog('❌ Invalid transaction hash format (must start with 0x and be at least 66 characters)', 'error');
        setIsSearching(false);
        return;
      }

      addLog(`🔍 Resolving transaction hash to wallet ID...`, 'info');

      // Step 2: Call the wallet-metadata proxy with resolve-wallet-id action
      const resolveParams = new URLSearchParams({
        action: 'resolve-wallet-id',
        type: 'by-tx',
        identifier: txHash
      });

      const resolveResponse = await fetch(`/api/wallet-metadata?${resolveParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin,
          'User-Agent': navigator.userAgent
        }
      });

      if (!resolveResponse.ok) {
        if (resolveResponse.status === 404) {
          addLog(`❌ No wallet found for transaction hash: ${txHash.slice(0, 10)}...`, 'error');
        } else {
          throw new Error(`Transaction hash resolution failed: ${resolveResponse.status}`);
        }
        setIsSearching(false);
        return;
      }

      const resolveData = await resolveResponse.json();

      if (!resolveData.success || !resolveData.walletId) {
        addLog(`❌ No wallet ID found for transaction hash: ${txHash.slice(0, 10)}...`, 'error');
        setIsSearching(false);
        return;
      }

      const walletId = resolveData.walletId;
      const traceId = resolveData.traceId;
      setWalletId(walletId);
      setResolutionType('Transaction Hash');

      addLog(`✅ Found wallet ID: ${walletId.slice(0, 8)}... from transaction hash`, 'success');
      addLog(`📝 Trace ID: ${traceId.slice(0, 8)}...`, 'info');

      // Step 3: Load transaction timeline
      await loadWalletTimeline(walletId);

    } catch (error) {
      addLog(`❌ Transaction hash search failed: ${error.message}`, 'error');
      console.error('Transaction hash search error:', error);
      setIsSearching(false);
    }
  };

  // Format and copy complete transaction data
  const copyTransactionData = async (tx) => {
    try {
      const formattedData = `
TRANSACTION DETAILS
==================
Type: ${tx.transactionType || 'Unknown'}
Date: ${tx.date?.toLocaleString() || 'Unknown'}

TRANSACTION INFO
---------------
${tx.traceId ? `Trace ID: ${tx.traceId}` : ''}
${tx.txHash ? `TX Hash: ${tx.txHash}` : ''}
${tx.txid ? `TX ID: ${tx.txid}` : ''}
${tx.id ? `ID: ${tx.id}` : ''}
Status: ${tx.status || 'Unknown'}
${tx.timestamp ? `Timestamp: ${new Date(tx.timestamp * 1000).toLocaleString()}` : ''}
${tx.addedAt ? `Added At: ${new Date(tx.addedAt).toLocaleString()}` : ''}

TOKEN & AMOUNT INFO
------------------
${tx.token ? `Token: ${tx.token}` : ''}
${tx.amount ? `Amount: ${tx.amount}` : ''}

ADDRESSES
---------
${tx.zkAddr ? `ZK Address: ${tx.zkAddr}` : ''}
${tx.recipientAddress ? `Recipient: ${tx.recipientAddress}` : ''}
${tx.senderAddress ? `Sender: ${tx.senderAddress}` : ''}

ADDITIONAL INFO
---------------
${tx.nullifiers?.length > 0 ? `Nullifiers: ${tx.nullifiers.length} nullifier${tx.nullifiers.length !== 1 ? 's' : ''}` : ''}
${tx.memo ? `Memo: ${tx.memo}` : ''}

RAW DATA
--------
${JSON.stringify(tx, null, 2)}
`;

      await navigator.clipboard.writeText(formattedData.trim());
      addLog('Transaction data copied to clipboard', 'success');
    } catch (error) {
      console.error('Failed to copy transaction data:', error);
      addLog('Failed to copy transaction data', 'error');
    }
  };

  // Export transactions to CSV
  const exportToCSV = () => {
    if (!transactionHistory.length) {
      addLog('No transactions to export', 'error');
      return;
    }

    try {
      // CSV headers
      const headers = [
        'Type',
        'Status',
        'Token',
        'Amount',
        'Trace ID',
        'Transaction Hash',
        'Transaction ID',
        'ZK Address',
        'Recipient Address',
        'Sender Address',
        'Timestamp',
        'Added At',
        'Memo',
        'Nullifiers Count'
      ];

      // Convert transactions to CSV rows
      const csvRows = transactionHistory.map(tx => [
        tx.transactionType || '',
        tx.status || '',
        tx.token || '',
        tx.amount || '',
        tx.traceId || '',
        tx.txHash || '',
        tx.txid || '',
        tx.id || '',
        tx.zkAddr || '',
        tx.recipientAddress || '',
        tx.senderAddress || '',
        tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : '',
        tx.addedAt ? new Date(tx.addedAt).toISOString() : '',
        tx.memo ? `"${tx.memo.replace(/"/g, '""')}"` : '', // Escape quotes for CSV
        tx.nullifiers?.length || 0
      ]);

      // Create CSV content
      const csvContent = [
        headers.join(','),
        ...csvRows.map(row => row.map(field => `"${field}"`).join(','))
      ].join('\n');

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `wallet-transactions-${walletId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      addLog(`CSV export completed: ${transactionHistory.length} transactions`, 'success');
    } catch (error) {
      console.error('Failed to export CSV:', error);
      addLog('Failed to export CSV', 'error');
    }
  };

  // Clear all state
  const clearState = () => {
    setWalletId(null);
    setResolutionType(null);
    setTransactionHistory([]);
    setLogs([]);
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

      // Handle EOA search (direct approach)
      if (searchType === 'eoa') {
        let walletAddressParam = (searchQuery || '').trim();

        // Normalize EOA to checksum for consistent Redis key matches
        try {
          walletAddressParam = getAddress(walletAddressParam);
        } catch (_) {
          addLog('❌ Invalid EOA address format', 'error');
          setIsSearching(false);
          return;
        }

        // Use wallet metadata endpoint for EOA resolution
        const resolveEndpoint = `/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddressParam)}`;
        const queryType = 'EOA Address';

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
          setIsSearching(false);
          return;
        }

        // Find the first key with a walletId (same logic as WalletContext.jsx)
        const walletKey = resolveData.keys.find(key => key.walletId);
        if (!walletKey || !walletKey.walletId) {
          addLog(`❌ No wallet ID found in metadata for: ${searchQuery}`, 'error');
          setIsSearching(false);
          return;
        }

        const walletId = walletKey.walletId;
        setWalletId(walletId);
        setResolutionType(queryType);

        addLog(`✅ Found wallet: ${walletId.slice(0, 8)}... (${queryType})`, 'success');

        // Load transaction timeline
        await loadWalletTimeline(walletId);

      } else if (searchType === 'railgun') {
        // Handle Railgun address search (two-step process)
        await handleRailgunSearch(searchQuery.trim());

      } else if (searchType === 'txhash') {
        // Handle Transaction Hash search
        await handleTxHashSearch(searchQuery.trim());
      }

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
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-blue-400 mb-2">Admin Dashboard</h1>
              <p className="text-gray-400">Manage compliance and points data</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors text-white font-medium flex items-center gap-2"
              title="Logout from admin panel"
            >
              🚪 Logout
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="bg-gray-800 rounded-lg p-1">
            <div className="flex">
              <button
                onClick={() => setActiveTab('compliance')}
                className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                  activeTab === 'compliance'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                📋 Compliance
              </button>
              <button
                onClick={() => setActiveTab('points')}
                className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                  activeTab === 'points'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                💰 Points
              </button>
              <button
                onClick={() => setActiveTab('analytics')}
                className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                  activeTab === 'analytics'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                📊 Analytics
              </button>
              <button
                onClick={() => setActiveTab('access-codes')}
                className={`flex-1 px-6 py-3 rounded-md font-medium transition-colors ${
                  activeTab === 'access-codes'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                🔐 Access Codes
              </button>
            </div>
          </div>
        </div>

        {/* Compliance Tab Content */}
        {activeTab === 'compliance' && (
          <>
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
                <option value="railgun">Railgun Address (0zk...)</option>
                <option value="txhash">Transaction Hash</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">
                {searchType === 'eoa' && 'EOA Address'}
                {searchType === 'railgun' && 'Railgun Address'}
                {searchType === 'txhash' && 'Transaction Hash'}
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={`Enter ${searchType === 'eoa' ? 'EOA address' : searchType === 'railgun' ? 'Railgun address' : 'transaction hash'}`}
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
              <h2 className="text-xl font-semibold text-blue-300">Transaction History</h2>
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
                <div className="flex items-center justify-between mb-4">
                  <div className="text-green-400 font-medium">
                    📊 Found {transactionHistory.length} transaction{transactionHistory.length !== 1 ? 's' : ''}
                  </div>
                  <button
                    onClick={exportToCSV}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2"
                    title="Export all transactions to CSV"
                  >
                    📥 Export CSV
                  </button>
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
                            onClick={() => copyTransactionData(tx)}
                            className="text-xs text-gray-400 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700"
                            title="Copy complete transaction data"
                          >
                            Copy
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
              <h2 className="text-xl font-semibold mb-4 text-blue-300">Activity Logs</h2>

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
          </>
        )}

        {/* Points Tab Content */}
        {activeTab === 'points' && (
          <div className="space-y-6">
            {/* Points Overview */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-blue-300">💰 Points Dashboard</h2>
                <div className="text-sm text-gray-400">
                  Total Users: {pointsData.length}
                </div>
              </div>

              {/* Sorting Controls */}
              <div className="flex items-center gap-4 mb-6">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-300">Sort by:</label>
                  <select
                    value={pointsSortBy}
                    onChange={(e) => setPointsSortBy(e.target.value)}
                    className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                  >
                    <option value="lexieId">LexieID</option>
                    <option value="points">Points</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-gray-300">Order:</label>
                  <select
                    value={pointsSortOrder}
                    onChange={(e) => setPointsSortOrder(e.target.value)}
                    className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                  >
                    <option value="asc">A-Z / Low-High</option>
                    <option value="desc">Z-A / High-Low</option>
                  </select>
                </div>

                <button
                  onClick={exportPointsToCSV}
                  disabled={isLoadingPoints || !pointsData.length}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2"
                  title="Export points data to CSV"
                >
                  📥 Export CSV
                </button>
              </div>

              {/* Loading State */}
              {isLoadingPoints && (
                <div className="text-center py-8">
                  <div className="text-blue-400">Loading points data...</div>
                </div>
              )}

              {/* Points Table */}
              {!isLoadingPoints && pointsData.length > 0 && (
                <div className="bg-gray-900 rounded-md overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-800">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            LexieID
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            EOA Address
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Railgun Address
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Total Points
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {getSortedPointsData().map((user, index) => (
                          <tr key={index} className="hover:bg-gray-800/50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-blue-300">
                              {user.lexieId || 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-orange-300 break-all">
                              {user.eoaAddress ? `${user.eoaAddress.slice(0, 6)}...${user.eoaAddress.slice(-4)}` : 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-purple-300 break-all">
                              {user.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : 'N/A'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-green-300 text-right font-medium">
                              {user.points?.toLocaleString() || 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No Data Message */}
              {!isLoadingPoints && pointsData.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No users with points found
                </div>
              )}
            </div>

            {/* Activity Logs for Points Tab */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-300">Activity Logs</h2>

              <div className="bg-gray-900 rounded-md p-4 max-h-64 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-500 text-center">No logs yet. Points data will be logged here.</p>
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
        )}

        {/* Analytics Tab Content */}
        {activeTab === 'analytics' && (
          <div className="space-y-6">
            {/* Analytics Overview */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-blue-300">📊 Platform Analytics</h2>
                <button
                  onClick={loadAnalyticsData}
                  disabled={isLoadingAnalytics}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2"
                  title="Refresh analytics data"
                >
                  🔄 {isLoadingAnalytics ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {/* Time Filters */}
              <div className="mb-6 p-4 bg-gray-900 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Time Filters</h3>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-400">Period:</label>
                    <select
                      value={analyticsPeriod}
                      onChange={(e) => setAnalyticsPeriod(e.target.value)}
                      className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                    >
                      <option value="all">All Time</option>
                      <option value="24h">Last 24 Hours</option>
                      <option value="7d">Last 7 Days</option>
                      <option value="30d">Last 30 Days</option>
                      <option value="90d">Last 90 Days</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>

                  {analyticsPeriod === 'custom' && (
                    <>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-400">Start:</label>
                        <input
                          type="date"
                          value={analyticsStartDate}
                          onChange={(e) => setAnalyticsStartDate(e.target.value)}
                          className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-400">End:</label>
                        <input
                          type="date"
                          value={analyticsEndDate}
                          onChange={(e) => setAnalyticsEndDate(e.target.value)}
                          className="px-3 py-1 bg-gray-700 border border-gray-600 rounded-md text-white text-sm"
                        />
                      </div>
                    </>
                  )}

                  <button
                    onClick={loadAnalyticsData}
                    disabled={isLoadingAnalytics}
                    className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors"
                  >
                    Apply Filter
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {analyticsPeriod === 'all' && 'Showing data for all time'}
                  {analyticsPeriod === '24h' && 'Showing data from the last 24 hours'}
                  {analyticsPeriod === '7d' && 'Showing data from the last 7 days'}
                  {analyticsPeriod === '30d' && 'Showing data from the last 30 days'}
                  {analyticsPeriod === '90d' && 'Showing data from the last 90 days'}
                  {analyticsPeriod === 'custom' && `Showing data from ${analyticsStartDate || 'start'} to ${analyticsEndDate || 'end'}`}
                </p>
              </div>

              {/* Loading State */}
              {isLoadingAnalytics && (
                <div className="text-center py-8">
                  <div className="text-blue-400">Loading analytics data...</div>
                </div>
              )}

              {/* Analytics Data */}
              {!isLoadingAnalytics && analyticsData && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Wallet Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">🏦 Wallet Statistics</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Railgun Wallets:</span>
                        <span className="text-blue-300 font-medium">{analyticsData.totalRailgunWallets?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total EOA Wallets:</span>
                        <span className="text-green-300 font-medium">{analyticsData.totalEOAWallets?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Wallets with Balances:</span>
                        <span className="text-purple-300 font-medium">{analyticsData.walletsWithBalances?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Transaction Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">💸 Transaction Statistics</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Transactions:</span>
                        <span className="text-green-300 font-medium">{analyticsData.totalTransactions?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Shield Transactions:</span>
                        <span className="text-blue-300 font-medium">{analyticsData.shieldTransactions?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Unshield Transactions:</span>
                        <span className="text-red-300 font-medium">{analyticsData.unshieldTransactions?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Transfer Transactions:</span>
                        <span className="text-purple-300 font-medium">{analyticsData.transferTransactions?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Volume Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">💰 Volume Statistics</h3>
                    <p className="text-xs text-gray-500 mb-3">USD value of tokens processed through privacy system</p>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Shielded Volume:</span>
                        <span className="text-green-300 font-medium">{analyticsData.totalShieldedVolume ? `$${analyticsData.totalShieldedVolume.toLocaleString(undefined, {maximumFractionDigits: 2})}` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Unshielded Volume:</span>
                        <span className="text-red-300 font-medium">{analyticsData.totalUnshieldedVolume ? `$${analyticsData.totalUnshieldedVolume.toLocaleString(undefined, {maximumFractionDigits: 2})}` : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Average Transaction:</span>
                        <span className="text-blue-300 font-medium">{analyticsData.averageTransactionValue ? `$${analyticsData.averageTransactionValue.toLocaleString(undefined, {maximumFractionDigits: 2})}` : 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* User Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">👥 User Statistics</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Lexie IDs:</span>
                        <span className="text-green-300 font-medium">{analyticsData.totalLexieIds?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Users with Points:</span>
                        <span className="text-blue-300 font-medium">{analyticsData.usersWithPoints?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Points Awarded:</span>
                        <span className="text-purple-300 font-medium">{analyticsData.totalPointsAwarded?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Activity Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">📈 Activity Statistics</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Active Wallets (30d):</span>
                        <span className="text-green-300 font-medium">{analyticsData.activeWallets30d?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Transactions (24h):</span>
                        <span className="text-blue-300 font-medium">{analyticsData.transactions24h?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Volume (24h):</span>
                        <span className="text-purple-300 font-medium">{analyticsData.volume24h ? `$${analyticsData.volume24h.toLocaleString(undefined, {maximumFractionDigits: 2})}` : 'N/A'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Token Statistics */}
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-4">🪙 Token Statistics</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Unique Tokens:</span>
                        <span className="text-green-300 font-medium">{analyticsData.uniqueTokens?.toLocaleString() || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Most Used Token:</span>
                        <span className="text-blue-300 font-medium text-sm">{analyticsData.mostUsedToken || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-400">Total Nullifiers:</span>
                        <span className="text-red-300 font-medium">{analyticsData.totalNullifiers?.toLocaleString() || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* No Data Message */}
              {!isLoadingAnalytics && !analyticsData && (
                <div className="text-center py-8 text-gray-400">
                  No analytics data available. Click refresh to load data.
                </div>
              )}
            </div>

            {/* Activity Logs for Analytics Tab */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-300">Activity Logs</h2>

              <div className="bg-gray-900 rounded-md p-4 max-h-64 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-500 text-center">No logs yet. Analytics activity will be logged here.</p>
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
        )}

        {/* Access Codes Tab Content */}
        {activeTab === 'access-codes' && (
          <div className="space-y-6">
            {/* Access Codes Overview */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-blue-300">🔐 Access Codes Dashboard</h2>
                <div className="text-sm text-gray-400">
                  Total Codes: {accessCodesData.length}
                </div>
              </div>

              {/* Create New Access Code */}
              <div className="mb-6 p-4 bg-gray-900 rounded-lg">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Create New Access Code</h3>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    value={newAccessCode}
                    onChange={(e) => setNewAccessCode(e.target.value.toUpperCase().slice(0, 15))}
                    placeholder="Enter access code (3-15 chars)"
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md focus:ring-blue-500 focus:border-blue-500 text-white font-mono"
                    onKeyPress={(e) => e.key === 'Enter' && createAccessCode()}
                  />
                  <button
                    onClick={createAccessCode}
                    disabled={isCreatingCode || !newAccessCode.trim()}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2"
                  >
                    {isCreatingCode ? 'Creating...' : 'Create'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Codes are case-insensitive and can be used multiple times
                </p>
              </div>

              {/* Access Codes Stats */}
              {accessCodesStats && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-2">Total Codes</h3>
                    <div className="text-2xl font-bold text-green-300">{accessCodesStats.totalCodes || 0}</div>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-2">Active Codes</h3>
                    <div className="text-2xl font-bold text-green-300">{accessCodesStats.activeCodes || 0}</div>
                  </div>
                  <div className="bg-gray-900 rounded-lg p-4">
                    <h3 className="text-lg font-medium text-blue-300 mb-2">Total Uses</h3>
                    <div className="text-2xl font-bold text-purple-300">{accessCodesStats.totalUses || 0}</div>
                  </div>
                </div>
              )}

              {/* Loading State */}
              {isLoadingAccessCodes && (
                <div className="text-center py-8">
                  <div className="text-blue-400">Loading access codes...</div>
                </div>
              )}

              {/* Access Codes Table */}
              {!isLoadingAccessCodes && accessCodesData.length > 0 && (
                <div className="bg-gray-900 rounded-md overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-800">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Access Code
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Usage Count
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Created
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700">
                        {accessCodesData.map((code, index) => (
                          <tr key={index} className="hover:bg-gray-800/50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-blue-300">
                              {code.code}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                code.isActive ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                              }`}>
                                {code.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-purple-300">
                              {code.usageCount || 0}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                              {new Date(code.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                              {code.isActive && (
                                <button
                                  onClick={() => deactivateAccessCode(code.id, code.code)}
                                  className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded transition-colors"
                                >
                                  Deactivate
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* No Data Message */}
              {!isLoadingAccessCodes && accessCodesData.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No access codes found. Create your first access code above.
                </div>
              )}
            </div>

            {/* Activity Logs for Access Codes Tab */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h2 className="text-xl font-semibold mb-4 text-blue-300">Activity Logs</h2>

              <div className="bg-gray-900 rounded-md p-4 max-h-64 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="text-gray-500 text-center">No logs yet. Access code activity will be logged here.</p>
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
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
