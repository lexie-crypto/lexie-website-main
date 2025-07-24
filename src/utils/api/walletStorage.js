/**
 * Wallet Balance API Proxy Service 
 * Secure communication with lexie-be backend for Redis storage
 * Backend handles all HMAC authentication and Redis TLS connections
 */

// API configuration - using backend proxy endpoints for security
const API_ENDPOINTS = {
  storePrivateBalances: '/api/store-private-balances',
  getPrivateBalances: '/api/get-private-balances',
  storeWalletMetadata: '/api/store-wallet-metadata',
  getWalletMetadata: '/api/get-wallet-metadata',
  storeBalances: '/api/store-balances',
  getBalances: '/api/get-balances'
};

/**
 * Get backend API base URL
 * Points to lexie-be backend where Redis operations happen securely
 */
function getBackendUrl() {
  // Use environment variable or fallback based on hostname
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3000'; // Local backend
    }
  }
  
  // Production backend URL - adjust as needed
  return process.env.VITE_BACKEND_URL || 'https://api.lexiecrypto.com';
}

/**
 * Generate basic headers for backend API requests
 * Backend handles all authentication, Redis, and HMAC signing
 */
function generateHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': window.location.origin,
  };
}

/**
 * Wallet Balance Service - Proxies requests to secure backend
 */
export class WalletBalanceService {
  
  /**
   * Store private balances via backend proxy
   * @param {string} walletId - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @param {Array} balances - Array of private balance objects
   * @returns {Promise<boolean>} Success status
   */
  static async storePrivateBalances(walletId, chainId, balances) {
    console.log('[WalletBalanceService] 💾 Storing private balances via backend:', {
      walletId: walletId?.slice(0, 8) + '...',
      chainId,
      balanceCount: balances?.length || 0
    });

    try {
      const backendUrl = getBackendUrl();
      const endpoint = `${backendUrl}${API_ENDPOINTS.storePrivateBalances}`;
      
      const balanceData = {
        walletId,
        chainId,
        balances: balances.filter(balance => 
          balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
        )
      };
      
      const headers = generateHeaders();
      
      console.log(`[WalletBalanceService] Calling backend endpoint:`, {
        url: endpoint,
        method: 'POST',
        balanceCount: balanceData.balances.length
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(balanceData),
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('[WalletBalanceService] ❌ Store private balances API error:', result);
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('[WalletBalanceService] ✅ Successfully stored private balances via backend:', result);
      return true;

    } catch (error) {
      console.error('[WalletBalanceService] ❌ Failed to store private balances:', error);
      
      // Return false instead of throwing - this is non-critical for UI
      if (error.name === 'TimeoutError') {
        console.warn('[WalletBalanceService] Store request timeout - continuing without storage');
      }
      return false;
    }
  }

  /**
   * Get private balances via backend proxy
   * @param {string} walletId - RAILGUN wallet ID
   * @param {number} chainId - Chain ID
   * @returns {Promise<Object|null>} Private balance data or null if not found
   */
  static async getPrivateBalances(walletId, chainId) {
    console.log('[WalletBalanceService] 📥 Getting private balances via backend:', {
      walletId: walletId?.slice(0, 8) + '...',
      chainId
    });

    try {
      const backendUrl = getBackendUrl();
      const endpoint = `${backendUrl}${API_ENDPOINTS.getPrivateBalances}/${walletId}-${chainId}`;
      
      const headers = generateHeaders();
      
      console.log(`[WalletBalanceService] Calling backend endpoint:`, {
        url: endpoint,
        method: 'GET'
      });

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          console.log('[WalletBalanceService] ℹ️ No private balance data found in backend');
          return null;
        }
        
        console.error('[WalletBalanceService] ❌ Get private balances API error:', result);
        return null;
      }

      const { balances, updatedAt } = result.data;

      console.log('[WalletBalanceService] ✅ Retrieved private balance data via backend:', {
        balanceCount: balances?.length || 0,
        updatedAt: new Date(updatedAt).toISOString(),
        source: 'Backend Redis'
      });

      return { balances, updatedAt };

    } catch (error) {
      console.error('[WalletBalanceService] ❌ Failed to retrieve private balance data:', error);
      
      if (error.name === 'TimeoutError') {
        console.warn('[WalletBalanceService] Get request timeout');
      }
      return null;
    }
  }

  /**
   * Store wallet metadata via backend proxy
   * @param {string} walletAddress - Wallet address
   * @param {string} walletId - RAILGUN wallet ID
   * @returns {Promise<boolean>} Success status
   */
  static async storeWalletMetadata(walletAddress, walletId) {
    console.log('[WalletBalanceService] 💾 Storing wallet metadata via backend:', {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      walletId: walletId?.slice(0, 8) + '...'
    });

    try {
      const backendUrl = getBackendUrl();
      const endpoint = `${backendUrl}${API_ENDPOINTS.storeWalletMetadata}`;
      
      const metadataData = {
        walletAddress,
        walletId
      };
      
      const headers = generateHeaders();

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(metadataData),
        signal: AbortSignal.timeout(30000),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('[WalletBalanceService] ❌ Store wallet metadata API error:', result);
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('[WalletBalanceService] ✅ Successfully stored wallet metadata via backend');
      return true;

    } catch (error) {
      console.error('[WalletBalanceService] ❌ Failed to store wallet metadata:', error);
      return false;
    }
  }

  /**
   * Get wallet metadata via backend proxy
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Object|null>} Wallet metadata or null if not found
   */
  static async getWalletMetadata(walletAddress) {
    console.log('[WalletBalanceService] 📥 Getting wallet metadata via backend:', {
      walletAddress: walletAddress?.slice(0, 8) + '...'
    });

    try {
      const backendUrl = getBackendUrl();
      const endpoint = `${backendUrl}${API_ENDPOINTS.getWalletMetadata}/${walletAddress}`;
      
      const headers = generateHeaders();

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 404) {
          console.log('[WalletBalanceService] ℹ️ No wallet metadata found in backend');
          return null;
        }
        
        console.error('[WalletBalanceService] ❌ Get wallet metadata API error:', result);
        return null;
      }

      console.log('[WalletBalanceService] ✅ Retrieved wallet metadata via backend');
      return result.data;

    } catch (error) {
      console.error('[WalletBalanceService] ❌ Failed to retrieve wallet metadata:', error);
      return null;
    }
  }
}

// Legacy function exports for backward compatibility
export async function storePrivateBalances(walletId, chainId, balances) {
  return WalletBalanceService.storePrivateBalances(walletId, chainId, balances);
}

export async function getPrivateBalances(walletId, chainId) {
  return WalletBalanceService.getPrivateBalances(walletId, chainId);
}

export async function storeWalletMetadata(walletAddress, walletId) {
  return WalletBalanceService.storeWalletMetadata(walletAddress, walletId);
}

export async function getWalletMetadata(walletAddress) {
  return WalletBalanceService.getWalletMetadata(walletAddress);
}

// Legacy combined balance functions (keeping for compatibility)
export async function storeBalances(walletId, chainId, balances) {
  console.warn('[WalletBalanceService] DEPRECATED: storeBalances() - use storePrivateBalances() instead');
  return WalletBalanceService.storePrivateBalances(walletId, chainId, balances);
}

export async function getBalances(walletId, chainId) {
  console.warn('[WalletBalanceService] DEPRECATED: getBalances() - use getPrivateBalances() instead');
  return WalletBalanceService.getPrivateBalances(walletId, chainId);
}

export default {
  WalletBalanceService,
  storeWalletMetadata,
  getWalletMetadata,
  storeBalances,
  getBalances,
  storePrivateBalances,
  getPrivateBalances
}; 