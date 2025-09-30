/**
 * Chain Manager for IDB Sync
 * Handles chain discovery, tracking, and management for chain-specific sync operations
 */

// Dynamic imports to avoid circular dependencies
let stateModule = null;
let apiModule = null;

const getStateModule = async () => {
  if (!stateModule) {
    stateModule = await import('./state.js');
  }
  return stateModule;
};

const getApiModule = async () => {
  if (!apiModule) {
    apiModule = await import('./api.js');
  }
  return apiModule;
};

// Standard chain IDs supported by Railgun
export const SUPPORTED_CHAIN_IDS = [1, 56, 137, 42161]; // ETH, BSC, Polygon, Arbitrum

/**
 * Get chains that a wallet has scanned
 * Checks local state and Redis metadata
 */
export const getScannedChainsForWallet = async (walletId) => {
  try {
    const stateMod = await getStateModule();
    const apiMod = await getApiModule();

    // Check local state first
    const localChains = stateMod.getScannedChains(walletId) || [];

    // Check Redis for additional chains (in case local state is incomplete)
    const redisChains = [];
    try {
      for (const chainId of SUPPORTED_CHAIN_IDS) {
        const hasData = await apiMod.checkChainBootstrapExists(chainId);
        if (hasData) {
          redisChains.push(chainId);
        }
      }
    } catch (redisError) {
      console.warn('[ChainManager] Redis check failed, using local state only:', redisError.message);
    }

    // Combine and deduplicate
    let allChains = [...new Set([...localChains, ...redisChains])];

    // If no chains found in local state or Redis, try to discover from IDB
    if (allChains.length === 0) {
      console.log(`[ChainManager] No chains found in state/Redis, attempting IDB discovery...`);
      try {
        const discoveredChains = await discoverChainsFromIDB(walletId);
        allChains = discoveredChains;
        console.log(`[ChainManager] Discovered ${discoveredChains.length} chains from IDB:`, discoveredChains);
      } catch (discoveryError) {
        console.warn(`[ChainManager] IDB discovery failed:`, discoveryError.message);
      }
    }

    console.log(`[ChainManager] Wallet ${walletId.substring(0, 8)}... has scanned chains:`, allChains);
    return allChains;

  } catch (error) {
    console.error('[ChainManager] Failed to get scanned chains:', error);
    return [];
  }
};

/**
 * Mark a chain as scanned for a wallet
 */
export const markChainAsScanned = async (walletId, chainId) => {
  try {
    const stateMod = await getStateModule();
    const currentChains = stateMod.getScannedChains(walletId) || [];

    if (!currentChains.includes(chainId)) {
      currentChains.push(chainId);
      stateMod.setScannedChains(walletId, currentChains);
      console.log(`[ChainManager] Marked chain ${chainId} as scanned for wallet ${walletId.substring(0, 8)}...`);
    }

    return true;
  } catch (error) {
    console.error('[ChainManager] Failed to mark chain as scanned:', error);
    return false;
  }
};

/**
 * Check if a specific chain has been scanned for a wallet
 */
export const getChainScanStatus = async (walletId, chainId) => {
  try {
    const scannedChains = await getScannedChainsForWallet(walletId);
    const isScanned = scannedChains.includes(chainId);

    console.log(`[ChainManager] Chain ${chainId} scan status for wallet ${walletId.substring(0, 8)}...: ${isScanned ? 'SCANNED' : 'NOT SCANNED'}`);
    return isScanned;
  } catch (error) {
    console.error('[ChainManager] Failed to check chain scan status:', error);
    return false;
  }
};

/**
 * Discover chains by analyzing IDB data structure
 * This is a fallback method when metadata is unavailable
 */
export const discoverChainsFromIDB = async (walletId) => {
  try {
    console.log(`[ChainManager] Discovering chains from IDB for wallet ${walletId.substring(0, 8)}...`);

    // Open LevelDB and scan for chain prefixes
    const db = await openLevelJSDB();
    const transaction = db.transaction(['railgun-engine-db'], 'readonly');
    const store = transaction.objectStore('railgun-engine-db');

    return new Promise((resolve, reject) => {
      const discoveredChains = new Set();

      const request = store.openCursor();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          // Extract chain ID from key (Railgun keys start with chainId:)
          const keyStr = cursor.key.toString();
          const chainMatch = keyStr.match(/^(\d+):/);

          if (chainMatch) {
            const chainId = parseInt(chainMatch[1]);
            if (SUPPORTED_CHAIN_IDS.includes(chainId)) {
              discoveredChains.add(chainId);
            }
          }

          cursor.continue();
        } else {
          // Discovery complete
          const chains = Array.from(discoveredChains);
          console.log(`[ChainManager] Discovered chains from IDB:`, chains);

          // Update local state
          const stateMod = getStateModule();
          stateMod.setScannedChains(walletId, chains);

          resolve(chains);
        }
      };

      request.onerror = () => {
        console.error('[ChainManager] IDB discovery failed');
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[ChainManager] Chain discovery from IDB failed:', error);
    return [];
  }
};

/**
 * Open LevelJS-backed IndexedDB database
 * (Duplicated from exporter.js to avoid circular imports)
 */
const openLevelJSDB = async () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('level-js-railgun-engine-db');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      console.warn(`[ChainManager] Database level-js-railgun-engine-db upgraded during chain discovery`);
    };
  });
};

/**
 * Get chain priority for export ordering
 * Higher priority chains get exported first
 */
export const getChainPriority = (chainId) => {
  const priorities = {
    56: 10,   // BSC - highest priority (most users)
    1: 9,     // Ethereum - very high priority
    137: 8,   // Polygon - high priority
    42161: 7  // Arbitrum - medium priority
  };

  return priorities[chainId] || 0;
};

/**
 * Sort chains by priority for export ordering
 */
export const sortChainsByPriority = (chainIds) => {
  return chainIds.sort((a, b) => getChainPriority(b) - getChainPriority(a));
};
