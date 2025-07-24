/**
 * Wallet Balance API Proxy Service 
 * Calls Vercel serverless functions which proxy to lexie-be backend
 * 
 * Flow: Frontend → Vercel Functions → lexie-be Backend (with HMAC auth)
 * This avoids CORS issues and keeps HMAC secrets server-side
 */

// API configuration - using Vercel serverless functions as proxies
const API_ENDPOINTS = {
  storePrivateBalances: '/api/store-private-balances',
  getPrivateBalances: '/api/get-private-balances',
  storeWalletMetadata: '/api/store-wallet-metadata',
  getWalletMetadata: '/api/get-wallet-metadata',
  storeBalances: '/api/store-balances',
  getBalances: '/api/get-balances'
};

/**
 * Get Vercel serverless function base URL
 * Uses local Vercel functions as proxies to lexie-be backend
 */
function getBackendUrl() {
  // Always use current domain for Vercel serverless functions
  if (typeof window !== 'undefined') {
    return window.location.origin; // Uses current domain (lexiecrypto.com, localhost, etc.)
  }
  
  // Fallback for SSR
  return '';
}

/**
 * Generate basic headers for Vercel serverless function calls
 * Vercel functions handle backend communication with HMAC auth
 */
function generateHeaders() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': window.location.origin,
  };
}

/**
 * Wallet Balance Service - Calls Vercel functions which proxy to backend
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
      
      console.log(`[WalletBalanceService] 🚀 FRONTEND: Calling backend endpoint:`, {
        url: endpoint,
        method: 'POST',
        backendUrl,
        apiEndpoint: API_ENDPOINTS.storePrivateBalances,
        fullEndpoint: endpoint,
        balanceCount: balanceData.balances.length,
        headers: Object.keys(headers),
        timestamp: Date.now()
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

      console.log(`[WalletBalanceService] 🚀 FRONTEND: Calling wallet metadata endpoint:`, {
        url: endpoint,
        method: 'POST',
        backendUrl,
        apiEndpoint: API_ENDPOINTS.storeWalletMetadata,
        fullEndpoint: endpoint,
        headers: Object.keys(headers),
        timestamp: Date.now()
      });

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