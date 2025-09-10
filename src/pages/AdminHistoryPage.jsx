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

  // Note: Admin authentication is handled by backend HMAC + role verification
  // Frontend will rely on backend to enforce admin access control

  // Note: HMAC authentication is handled by the /api/admin proxy
  // The proxy generates proper HMAC headers and forwards to backend

  /**
   * Process search query and get wallet data/transaction history
   */
  const processQuery = useCallback(async (query) => {
    if (!query.trim()) return;

    setLoading(true);
    setError('');

    try {
      console.log('[AdminHistory] Processing query:', query);

      // Check what type of input this is
      if (query.startsWith('0zk')) {
        // Direct Railgun address - resolve to walletId using backend
        console.log('[AdminHistory] Detected Railgun address, resolving to walletId...');

        const response = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          setWalletId(data.walletId);
          setResolutionType(data.resolutionType);
          console.log('[AdminHistory] Railgun address resolved:', {
            railgunAddress: query.slice(0, 10) + '...',
            walletId: data.walletId?.slice(0, 10) + '...',
            resolutionType: data.resolutionType
          });

          // Fetch transaction history for the resolved wallet
          await fetchTransactionHistory(data.walletId, 1, true);
        } else {
          setError(data.error || 'Failed to resolve Railgun address');
        }

      } else if (query.startsWith('0x') && query.length === 66) {
        // Transaction hash - use existing resolution
        const response = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success) {
          setWalletId(data.walletId);
          setResolutionType(data.resolutionType);
          console.log('[AdminHistory] Transaction hash resolved:', {
            query,
            walletId: data.walletId,
            resolutionType: data.resolutionType
          });

          // Fetch history for resolved wallet
          await fetchTransactionHistory(data.walletId, 1, true);
        } else {
          setError(data.error || 'Failed to resolve transaction hash');
        }

      } else if (query.startsWith('0x') && (query.length === 42 || query.length === 66)) {
        // EOA address - get wallet metadata and then transaction history
        console.log('[AdminHistory] Detected EOA address, getting wallet metadata...');

        const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(query)}`, {
          method: 'GET'
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.keys && data.keys.length > 0) {
          const walletInfo = data.keys[0]; // Get first wallet
          setWalletId(walletInfo.walletId);
          setResolutionType('eoa');

          console.log('[AdminHistory] EOA resolved to wallet:', {
            eoa: query,
            railgunAddress: walletInfo.railgunAddress?.slice(0, 10) + '...',
            walletId: walletInfo.walletId?.slice(0, 10) + '...',
            scannedChains: walletInfo.scannedChains
          });

          // Fetch transaction history using the walletId
          await fetchTransactionHistory(walletInfo.walletId, 1, true);
        } else {
          setError('No wallet found for this EOA address');
        }

      } else {
        setError('Invalid input format. Please enter an EOA address (0x...), transaction hash, or Railgun address (0zk...)');
      }

    } catch (err) {
      console.error('[AdminHistory] Query processing failed:', err);
      setError(`Failed to process query: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Fetch transaction history for a wallet
   */
  const fetchTransactionHistory = useCallback(async (targetWalletId, page = 1, reset = false) => {
    setLoading(true);
    setError('');

    try {
      console.log('[AdminHistory] Fetching history:', { targetWalletId, page });

      const response = await fetch(`/api/wallet-metadata?action=history&walletId=${targetWalletId}&page=${page}&pageSize=50`, {
        method: 'GET'
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
  }, []);

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

      const response = await fetch(`/api/wallet-metadata?action=history&subaction=export&walletId=${walletId}`, {
        method: 'GET'
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
  }, [walletId]);

  /**
   * Export transaction history as JSON
   */
  const exportJSON = useCallback(async () => {
    if (!walletId) return;

    try {
      console.log('[AdminHistory] Exporting JSON for wallet:', walletId);

      const response = await fetch(`/api/wallet-metadata?action=history&walletId=${walletId}&page=1&pageSize=1000`, {
        method: 'GET'
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
  }, [walletId, resolutionType]);

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
    processQuery(searchQuery);
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
        <h1>Railgun Wallet Inspector</h1>
        <p>Search by transaction hash, Railgun address, or EOA address for compliance and audit</p>
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
            <h3>Wallet Information</h3>
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
          <p>Enter a transaction hash, Railgun address (0zk...), or EOA address (0x...) to view wallet information and transaction history.</p>
        </div>
      )}
    </div>
  );
};

export default AdminHistoryPage;
