import React, { useState, useEffect, useCallback } from 'react';
import { formatUnits } from 'ethers';
import './AdminHistoryPage.css';

/**
 * Admin History Dashboard Component
 * Provides compliance and audit functionality for Railgun transactions
 */
const AdminHistoryPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [walletId, setWalletId] = useState('');
  const [transactionHistory, setTransactionHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [resolutionType, setResolutionType] = useState('');

  // Admin role check
  useEffect(() => {
    const adminRoles = ['admin', 'compliance', 'audit'];
    const userRole = localStorage.getItem('userRole') || 'user';

    if (!adminRoles.includes(userRole)) {
      setError('Admin access required. Please contact system administrator.');
      return;
    }

    console.log('[AdminHistory] Admin role verified:', userRole);
  }, []);

  /**
   * Generate HMAC headers for API authentication
   */
  const generateAuthHeaders = useCallback(async (method = 'GET', path = '') => {
    const timestamp = Date.now().toString();
    const secret = process.env.REACT_APP_HMAC_SECRET;

    if (!secret) {
      console.error('[AdminHistory] HMAC secret not configured');
      return {};
    }

    const payload = `${method}:${path}:${timestamp}`;
    const signature = btoa(String.fromCharCode(...new Uint8Array(
      new Uint8Array(await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(payload + secret)
      ))
    )));

    return {
      'Content-Type': 'application/json',
      'x-lexie-timestamp': timestamp,
      'x-lexie-signature': `sha256=${signature}`,
      'x-lexie-role': localStorage.getItem('userRole') || 'admin'
    };
  }, []);

  /**
   * Resolve search query to wallet ID
   */
  const resolveWalletId = useCallback(async (query) => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');

    try {
      console.log('[AdminHistory] Resolving query:', query);

      const headers = await generateAuthHeaders('GET', `/admin/history/resolve?q=${encodeURIComponent(query)}`);
      const response = await fetch(`/admin/history/resolve?q=${encodeURIComponent(query)}`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        setWalletId(data.walletId);
        setResolutionType(data.resolutionType);
        console.log('[AdminHistory] Query resolved:', {
          query,
          walletId: data.walletId,
          resolutionType: data.resolutionType
        });

        // Automatically fetch history for resolved wallet
        await fetchTransactionHistory(data.walletId, 1, true);
      } else {
        setError(data.error || 'Failed to resolve query');
      }
    } catch (err) {
      console.error('[AdminHistory] Resolution failed:', err);
      setError(`Failed to resolve query: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [generateAuthHeaders]);

  /**
   * Fetch transaction history for a wallet
   */
  const fetchTransactionHistory = useCallback(async (targetWalletId, page = 1, reset = false) => {
    setLoading(true);
    setError('');

    try {
      console.log('[AdminHistory] Fetching history:', { targetWalletId, page });

      const headers = await generateAuthHeaders('GET', `/admin/history/${targetWalletId}?page=${page}&pageSize=50`);
      const response = await fetch(`/admin/history/${targetWalletId}?page=${page}&pageSize=50`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        if (reset) {
          setTransactionHistory(data.items);
        } else {
          setTransactionHistory(prev => [...prev, ...data.items]);
        }
        setCurrentPage(page);
        setHasMore(data.pagination.hasMore);

        console.log('[AdminHistory] History fetched:', {
          walletId: targetWalletId,
          itemsCount: data.items.length,
          totalItems: data.pagination.total,
          page: data.pagination.page,
          hasMore: data.pagination.hasMore
        });
      } else {
        setError(data.error || 'Failed to fetch transaction history');
      }
    } catch (err) {
      console.error('[AdminHistory] Fetch failed:', err);
      setError(`Failed to fetch history: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [generateAuthHeaders]);

  /**
   * Load more transactions
   */
  const loadMore = useCallback(() => {
    if (walletId && hasMore && !loading) {
      fetchTransactionHistory(walletId, currentPage + 1, false);
    }
  }, [walletId, hasMore, loading, currentPage, fetchTransactionHistory]);

  /**
   * Export transaction history as CSV
   */
  const exportCSV = useCallback(async () => {
    if (!walletId) return;

    try {
      console.log('[AdminHistory] Exporting CSV for wallet:', walletId);

      const headers = await generateAuthHeaders('GET', `/admin/history/${walletId}/export.csv`);
      const response = await fetch(`/admin/history/${walletId}/export.csv`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet-${walletId.slice(0, 8)}-history.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      console.log('[AdminHistory] CSV export completed');
    } catch (err) {
      console.error('[AdminHistory] CSV export failed:', err);
      setError(`Export failed: ${err.message}`);
    }
  }, [walletId, generateAuthHeaders]);

  /**
   * Export transaction history as JSON
   */
  const exportJSON = useCallback(async () => {
    if (!walletId) return;

    try {
      console.log('[AdminHistory] Exporting JSON for wallet:', walletId);

      const headers = await generateAuthHeaders('GET', `/admin/history/${walletId}?page=1&pageSize=1000`);
      const response = await fetch(`/admin/history/${walletId}?page=1&pageSize=1000`, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.success) {
        const jsonData = {
          walletId,
          exportDate: new Date().toISOString(),
          resolutionType,
          totalTransactions: data.pagination.total,
          transactions: data.items
        };

        const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wallet-${walletId.slice(0, 8)}-history.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        console.log('[AdminHistory] JSON export completed');
      } else {
        setError(data.error || 'Failed to export JSON');
      }
    } catch (err) {
      console.error('[AdminHistory] JSON export failed:', err);
      setError(`Export failed: ${err.message}`);
    }
  }, [walletId, resolutionType, generateAuthHeaders]);

  /**
   * Format transaction amount for display
   */
  const formatAmount = (amount, decimals = 18) => {
    try {
      return formatUnits(amount || '0', decimals);
    } catch (err) {
      return '0';
    }
  };

  /**
   * Get transaction type display name
   */
  const getTransactionType = (type) => {
    const typeMap = {
      shield: 'Shield',
      unshield: 'Unshield',
      transfer_send: 'Private Send',
      transfer_receive: 'Private Receive'
    };
    return typeMap[type] || type;
  };

  /**
   * Handle search form submission
   */
  const handleSearch = (e) => {
    e.preventDefault();
    resolveWalletId(searchQuery);
  };

  /**
   * Copy transaction ID to clipboard
   */
  const copyTxId = async (txId) => {
    try {
      await navigator.clipboard.writeText(txId);
      console.log('[AdminHistory] Transaction ID copied:', txId);
      // Could show a toast notification here
    } catch (err) {
      console.error('[AdminHistory] Failed to copy transaction ID:', err);
    }
  };

  return (
    <div className="admin-history-container">
      <div className="admin-header">
        <h1>Railgun Admin History Dashboard</h1>
        <p>Compliance and audit trail for private transactions</p>
      </div>

      <div className="search-section">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Enter transaction hash, 0zk address, or EOA address"
            className="search-input"
            disabled={loading}
          />
          <button type="submit" className="search-button" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {walletId && (
          <div className="wallet-info">
            <h3>Resolved Wallet</h3>
            <p><strong>Wallet ID:</strong> {walletId}</p>
            <p><strong>Resolution Type:</strong> {resolutionType}</p>
            <div className="export-buttons">
              <button onClick={exportCSV} className="export-btn csv-btn">
                Export CSV
              </button>
              <button onClick={exportJSON} className="export-btn json-btn">
                Export JSON
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}

      {transactionHistory.length > 0 && (
        <div className="history-section">
          <h3>Transaction History ({transactionHistory.length} transactions)</h3>
          <div className="transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Token</th>
                  <th>Amount</th>
                  <th>Transaction Hash</th>
                  <th>0zk Address</th>
                  <th>Memo</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactionHistory.map((tx, index) => (
                  <tr key={`${tx.txid || tx.id}-${index}`}>
                    <td>
                      {tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleString() : 'Unknown'}
                    </td>
                    <td>{getTransactionType(tx.type)}</td>
                    <td>
                      <span className={`status-${tx.status || 'unknown'}`}>
                        {tx.status || 'Unknown'}
                      </span>
                    </td>
                    <td>{tx.token || 'Unknown'}</td>
                    <td>{formatAmount(tx.amount)}</td>
                    <td>
                      {tx.txHash ? (
                        <span
                          className="clickable-hash"
                          onClick={() => copyTxId(tx.txHash)}
                          title="Click to copy"
                        >
                          {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                        </span>
                      ) : (
                        'Pending'
                      )}
                    </td>
                    <td>
                      {tx.zkAddr ? (
                        <span
                          className="clickable-hash"
                          onClick={() => copyTxId(tx.zkAddr)}
                          title="Click to copy"
                        >
                          {tx.zkAddr.slice(0, 8)}...{tx.zkAddr.slice(-6)}
                        </span>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td>
                      {tx.memo ? (
                        <span title={tx.memo}>
                          {tx.memo.length > 20 ? `${tx.memo.slice(0, 20)}...` : tx.memo}
                        </span>
                      ) : (
                        'No memo'
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() => copyTxId(tx.txid || tx.id)}
                        className="action-btn"
                      >
                        Copy ID
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="load-more">
              <button onClick={loadMore} disabled={loading} className="load-more-btn">
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      )}

      {!walletId && !loading && !error && (
        <div className="empty-state">
          <h3>No Search Performed</h3>
          <p>Enter a transaction hash, 0zk address, or EOA address to begin compliance audit.</p>
        </div>
      )}
    </div>
  );
};

export default AdminHistoryPage;
