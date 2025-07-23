/**
 * Redis-Based Wallet Storage System
 * Sessionless storage using only walletAddress, walletId, and chainId as keys
 * No TTLs - data persists indefinitely until explicitly overwritten
 */

// HMAC secret for authentication
const HMAC_SECRET = import.meta.env.VITE_LEXIE_HMAC_SECRET;

/**
 * Generate HMAC signature for API authentication
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {string} timestamp - Timestamp in milliseconds
 * @returns {string} Signature in format 'sha256=<hex>'
 */
async function generateHmacSignature(method, path, timestamp) {
  if (!HMAC_SECRET) {
    throw new Error('VITE_LEXIE_HMAC_SECRET environment variable is required');
  }

  // Create the payload to sign: method:path:timestamp
  const payload = `${method}:${path}:${timestamp}`;
  
  // Use Web Crypto API for HMAC generation
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(HMAC_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(payload)
  );
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `sha256=${hashHex}`;
}

/**
 * Generate authentication headers for API requests
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API endpoint path
 * @returns {Object} Headers object with timestamp and signature
 */
async function generateAuthHeaders(method, path) {
  const timestamp = Date.now().toString();
  const signature = await generateHmacSignature(method, path, timestamp);
  
  return {
    'X-Lexie-Timestamp': timestamp,
    'X-Lexie-Signature': signature,
    'Content-Type': 'application/json',
    'Origin': window.location.origin,
    'User-Agent': navigator.userAgent,
  };
}

/**
 * Store wallet metadata in Redis (called once on wallet creation)
 * Key: wallet_meta:<walletAddress>
 * @param {string} walletAddress - Wallet address (EOA or RAILGUN)
 * @param {string} walletId - RAILGUN wallet ID
 * @returns {Promise<boolean>} Success status
 */
export async function storeWalletMetadata(walletAddress, walletId) {
  console.log('[WalletStorage] 💾 Storing wallet metadata:', {
    walletAddress: walletAddress?.slice(0, 8) + '...',
    walletId: walletId?.slice(0, 8) + '...'
  });

  try {
    const method = 'POST';
    const path = '/api/store-wallet-metadata';
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    const walletData = {
      walletAddress,
      walletId
    };
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
      body: JSON.stringify(walletData),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[WalletStorage] ❌ Store metadata API error:', result);
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('[WalletStorage] ✅ Successfully stored wallet metadata:', result);
    return true;

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to store wallet metadata:', error);
    return false; // Return false instead of throwing - this is non-critical for existing wallets
  }
}

/**
 * Get wallet metadata from Redis (used in WalletContext to restore walletId)
 * Key: wallet_meta:<walletAddress>
 * @param {string} walletAddress - Wallet address
 * @returns {Promise<Object|null>} Wallet metadata or null if not found
 */
export async function getWalletMetadata(walletAddress) {
  console.log('[WalletStorage] 📥 Retrieving wallet metadata:', {
    walletAddress: walletAddress?.slice(0, 8) + '...'
  });

  try {
    const method = 'GET';
    const path = `/api/get-wallet-metadata/${walletAddress}`;
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[WalletStorage] ℹ️ No wallet metadata found in Redis');
        return null;
      }
      
      console.error('[WalletStorage] ❌ Get metadata API error:', result);
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('[WalletStorage] ✅ Successfully retrieved wallet metadata:', {
      walletAddress: result.data.walletAddress?.slice(0, 8) + '...',
      walletId: result.data.walletId?.slice(0, 8) + '...',
      createdAt: result.data.createdAt ? new Date(result.data.createdAt).toISOString() : 'Unknown'
    });
    
    return result.data;

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to retrieve wallet metadata:', error);
    return null; // Return null instead of throwing to allow fallback to localStorage
  }
}

/**
 * Store balances in Redis (overwrites entire key with new result)
 * Key: wallet_balances:<walletId>-<chainId>
 * @param {string} walletId - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @param {Array} balances - Array of balance objects
 * @returns {Promise<boolean>} Success status
 */
export async function storeBalances(walletId, chainId, balances) {
  console.log('[WalletStorage] 💾 Storing balances:', {
    walletId: walletId?.slice(0, 8) + '...',
    chainId,
    balanceCount: balances?.length || 0
  });

  try {
    const method = 'POST';
    const path = '/api/store-balances';
    
    const balanceData = {
      walletId,
      chainId,
      balances: balances.filter(balance => 
        balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
      )
    };
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
      body: JSON.stringify(balanceData),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[WalletStorage] ❌ Store balances API error:', result);
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('[WalletStorage] ✅ Successfully stored balances:', result);
    return true;

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to store balances:', error);
    return false; // Return false instead of throwing - this is non-critical
  }
}

/**
 * Get balances from Redis with freshness check
 * Key: wallet_balances:<walletId>-<chainId>
 * @param {string} walletId - RAILGUN wallet ID  
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object|null>} Balance data with freshness info or null if not found
 */
export async function getBalances(walletId, chainId) {
  console.log('[WalletStorage] 📥 Checking Redis for balances:', {
    walletId: walletId?.slice(0, 8) + '...',
    chainId
  });

  try {
    const method = 'GET';
    const path = `/api/get-balances/${walletId}-${chainId}`;
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[WalletStorage] ℹ️ No balance data found in Redis');
        return null;
      }
      
      console.error('[WalletStorage] ❌ Get balances API error:', result);
      return null;
    }

    const { balances, updatedAt, isFresh } = result.data;
    const age = Date.now() - updatedAt;

    console.log('[WalletStorage] ✅ Retrieved balance data from Redis:', {
      balanceCount: balances?.length || 0,
      age: `${Math.round(age / 1000)}s`,
      isFresh,
      updatedAt: new Date(updatedAt).toISOString(),
      source: isFresh ? 'Redis (fresh)' : 'Redis (stale)'
    });

    return { balances, updatedAt, isFresh };

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to retrieve balance data from Redis:', error);
    return null;
  }
}

/**
 * Store private balances in Redis
 * Key: private_balances:<walletId>-<chainId>
 * @param {string} walletId - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @param {Array} balances - Array of private balance objects
 * @returns {Promise<boolean>} Success status
 */
export async function storePrivateBalances(walletId, chainId, balances) {
  console.log('[WalletStorage] 💾 Storing private balances:', {
    walletId: walletId?.slice(0, 8) + '...',
    chainId,
    balanceCount: balances?.length || 0
  });

  try {
    const method = 'POST';
    const path = '/api/store-private-balances';
    
    const balanceData = {
      walletId,
      chainId,
      balances: balances.filter(balance => 
        balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
      )
    };
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
      body: JSON.stringify(balanceData),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('[WalletStorage] ❌ Store private balances API error:', result);
      throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    console.log('[WalletStorage] ✅ Successfully stored private balances:', result);
    return true;

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to store private balances:', error);
    return false; // Return false instead of throwing - this is non-critical
  }
}

/**
 * Get private balances from Redis
 * Key: private_balances:<walletId>-<chainId>
 * @param {string} walletId - RAILGUN wallet ID
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object|null>} Private balance data or null if not found
 */
export async function getPrivateBalances(walletId, chainId) {
  console.log('[WalletStorage] 📥 Getting private balances from Redis:', {
    walletId: walletId?.slice(0, 8) + '...',
    chainId
  });

  try {
    const method = 'GET';
    const path = `/api/get-private-balances/${walletId}-${chainId}`;
    
    // Generate authentication headers
    const headers = await generateAuthHeaders(method, path);
    
    // Make the API request
    const response = await fetch(path, {
      method,
      headers,
    });

    const result = await response.json();

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[WalletStorage] ℹ️ No private balance data found in Redis');
        return null;
      }
      
      console.error('[WalletStorage] ❌ Get private balances API error:', result);
      return null;
    }

    const { balances, updatedAt } = result.data;

    console.log('[WalletStorage] ✅ Retrieved private balance data from Redis:', {
      balanceCount: balances?.length || 0,
      updatedAt: new Date(updatedAt).toISOString(),
      source: 'Redis'
    });

    return { balances, updatedAt };

  } catch (error) {
    console.error('[WalletStorage] ❌ Failed to retrieve private balance data from Redis:', error);
    return null;
  }
}

export default {
  storeWalletMetadata,
  getWalletMetadata,
  storeBalances,
  getBalances,
  storePrivateBalances,
  getPrivateBalances
}; 