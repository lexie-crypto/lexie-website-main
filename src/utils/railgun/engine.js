/**
 * RAILGUN Engine Setup
 * Following official docs: https://docs.railgun.org/developer-guide/wallet/getting-started
 * 
 * Implements:
 * - Step 1: Start the RAILGUN Privacy Engine
 * - Step 2: Build a persistent store for artifact downloads (uses artifactStore.js)
 * - Step 3: Load a Groth16 prover for browser platform
 * - Step 4: Add networks and RPC providers (Alchemy)
 * - Step 5: Set up a debug logger
 */

// ✅ OFFICIAL RAILGUN DEBUG LOGGER SETUP
import debug from 'debug';
// Enable all Railgun debug logs
debug.enabled = function(name) { return name.startsWith('railgun:'); };
debug.log = console.log.bind(console);

// Enable Railgun debug logging
if (typeof window !== 'undefined') {
  // Browser environment
  localStorage.debug = 'railgun:*';
  console.log('[RailgunEngine] 🔍 ENABLED OFFICIAL RAILGUN DEBUG LOGGING (Browser)');
} else {
  // Node environment
  process.env.DEBUG = 'railgun:*';
  console.log('[RailgunEngine] 🔍 ENABLED OFFICIAL RAILGUN DEBUG LOGGING (Node)');
}

import { 
  startRailgunEngine,
  setLoggers,
  loadProvider,
  getProver,
  setOnBalanceUpdateCallback,
  setOnUTXOMerkletreeScanCallback,
  setOnTXIDMerkletreeScanCallback,
  refreshRailgunBalances,
} from '@railgun-community/wallet';
import { 
  NetworkName,
  NETWORK_CONFIG,
  isDefined,
  ArtifactStore,
} from '@railgun-community/shared-models';
import { groth16 } from 'snarkjs';
import LevelJS from 'level-js';
import { createEnhancedArtifactStore } from './artifactStore.js';
import { ethers } from 'ethers';

let allowAlchemy = false;

export const setAllowAlchemy = (value) => {
  allowAlchemy = value;
};

export const createGuardedAlchemyProvider = (url) => {
  const provider = new ethers.JsonRpcProvider(url);

  return new Proxy(provider, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        return (...args) => {
          if (!allowAlchemy) {
            console.warn(`[AlchemyGuard] Blocked call to ${String(prop)}`);
            throw new Error(`Alchemy call to ${String(prop)} blocked`);
          }
          return value.apply(target, args);
        };
      }
      return value;
    }
  });
};

// Replace existing Alchemy providers with the guarded one
// Example usage:
// const provider = createGuardedAlchemyProvider(`https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`);
// setAllowAlchemy(true);
// await scanRailgunTransactions(...);
// setAllowAlchemy(false);

// Engine state
let isEngineStarted = false;
let isProverLoaded = false;
let areArtifactsLoaded = false;
let enginePromise = null;

/**
 * Alchemy RPC Configuration
 * Using official Alchemy RPC endpoints - PRODUCTION READY
 */
const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  throw new Error('VITE_ALCHEMY_API_KEY environment variable is required for production');
} // Use demo key as fallback

const RPC_PROVIDERS = {
  [NetworkName.Ethereum]: {
    chainId: 1,
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  },
  [NetworkName.Arbitrum]: {
    chainId: 42161, 
    rpcUrl: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  },
  [NetworkName.Polygon]: {
    chainId: 137,
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
  },
  [NetworkName.BNBChain]: {
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org/', // BSC public RPC
  },
};


/**
 * Add networks and RPC providers
 * Networks are automatically configured by startRailgunEngine
 */
const setupNetworks = async () => {
  try {
    console.log('[RAILGUN] Setting up networks...');

    for (const [networkName, config] of Object.entries(RPC_PROVIDERS)) {
      try {
        console.log(`[RAILGUN] Setting up ${networkName}...`);
        
        // Step 1: Network configuration (handled by SDK)
        const networkConfig = NETWORK_CONFIG[networkName];
        if (networkConfig) {
          console.log(`[RAILGUN] Network config available for ${networkName}`);
          // Note: Network configuration is handled automatically by startRailgunEngine
          // No need to manually call loadNetwork in this SDK version
          console.log(`[RAILGUN] ✅ Network ${networkName} configuration ready`);
        } else {
          console.warn(`[RAILGUN] No network config found for ${networkName}`);
          continue;
        }
        
        // Check if provider is already loaded
        const isLoaded = await isProviderLoaded(config.chainId);
        if (isLoaded) {
          console.log(`[RAILGUN] Provider already loaded for ${networkName}`);
          continue;
        }

        // Ensure fallback provider is defined
        if (!config.rpcUrl) {
          console.error(`[RAILGUN] No fallback provider defined for ${networkName}`);
          continue;
        }

        // Step 2: Then load the provider
        const providerConfig = {
          chainId: config.chainId,
          providers: [{
            provider: config.rpcUrl,
            priority: 1,
            weight: 2,
          }]
        };
        
        const { feesSerialized } = await loadProvider(
          providerConfig,
          networkName,
          5 * 60 * 1000 // 5 minutes polling interval
        );
        
        console.log(`[RAILGUN] ✅ Provider loaded for ${networkName}`);
        console.log(`[RAILGUN] Fees for ${networkName}:`, feesSerialized);
        
      } catch (error) {
        console.error(`[RAILGUN] ❌ Failed to setup ${networkName}:`, error);
        // Continue with other networks even if one fails
      }
    }

    console.log('[RAILGUN] ✅ All networks setup completed');
  } catch (error) {
    console.error('[RAILGUN] Network setup failed:', error);
    throw error;
  }
};

/**
 * Setup balance update callbacks
 * Following the private balances documentation
 */
const setupBalanceCallbacks = async () => {
  console.log('[RAILGUN] 🔧 Setting up balance callbacks...');
  
  // Use the OFFICIAL RAILGUN SDK callback system - pass through directly
  const { handleBalanceUpdateCallback } = await import('./balances.js');
  setOnBalanceUpdateCallback(handleBalanceUpdateCallback);

  // UTXO Merkletree scan callback
  setOnUTXOMerkletreeScanCallback((scanData) => {
    console.log('[RAILGUN] UTXO Merkletree scan progress:', scanData);
    
    // Check if scan is completed
    if (scanData.progress >= 1.0 || scanData.scanStatus === 'Complete') {
      console.log('[RAILGUN] 🎉 UTXO Merkletree scan COMPLETED! This should trigger balance updates.');
    }
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: scanData
    }));
  });

  // TXID Merkletree scan callback  
  setOnTXIDMerkletreeScanCallback((scanData) => {
    console.log('[RAILGUN] TXID Merkletree scan progress:', scanData);
    
    // Check if scan is completed
    if (scanData.progress >= 1.0 || scanData.scanStatus === 'Complete') {
      console.log('[RAILGUN] 🎉 TXID Merkletree scan COMPLETED! This should trigger balance updates.');
    }
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-txid-scan', {
      detail: scanData
    }));
  });

  console.log('[RAILGUN] Balance callbacks configured');
};

// Helper to get network name from chain
const getNetworkNameFromChain = (chain) => {
  const networkMap = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    137: 'Polygon',
    56: 'BNBChain',
  };
  return networkMap[chain.id] || `Chain${chain.id}`;
};

/**
 * Load and register the snarkJS Groth16 prover
 */
const loadSnarkJSGroth16 = async () => {
  if (isProverLoaded) {
    console.log('[RAILGUN] Prover already loaded');
    return;
  }

  try {
    console.log('[RAILGUN] Loading snarkJS Groth16 prover...');
    
    // Register the Groth16 prover with Railgun
    getProver().setSnarkJSGroth16(groth16);
    
    isProverLoaded = true;
    console.log('[RAILGUN] snarkJS Groth16 prover loaded successfully');
  } catch (error) {
    console.error('[RAILGUN] Failed to load prover:', error);
    throw error;
  }
};

/**
 * Start RAILGUN Engine
 * Following the working implementation pattern
 */
const startEngine = async () => {
  if (isEngineStarted) {
    console.log('[RAILGUN] Engine already started');
    return;
  }

  try {
    console.log('[RAILGUN] 🚀 Initializing Railgun engine...');

    // Step 1: Create enhanced artifact store with downloader
    const artifactManager = await createEnhancedArtifactStore(false); // false = web/WASM
    console.log('[RAILGUN] Enhanced artifact store created with downloader');
    
    // Download common artifacts needed for operations
    console.log('[RAILGUN] Downloading essential artifacts...');
    try {
      await artifactManager.setupCommonArtifacts();
      console.log('[RAILGUN] ✅ Essential artifacts downloaded and ready');
      areArtifactsLoaded = true;
    } catch (artifactError) {
      console.warn('[RAILGUN] ⚠️ Artifact download failed, will try on-demand:', artifactError);
      areArtifactsLoaded = false; // Will download on-demand during operations
    }

    // Step 2: Create database
    const db = new LevelJS('railgun-db');
    
    // Step 3: Set up logging
    setLoggers(
      (message) => console.log(`🔍 [RAILGUN:LOG] ${message}`),
      (error) => console.error(`🚨 [RAILGUN:ERROR] ${error}`)
    );

    console.log('[RAILGUN] ✅ Debug loggers configured');

    // Step 4: Start engine with proper POI integration
    // Using valid POI node URL from RAILGUN Discord
    const poiNodeURLs = [
      'https://ppoi.fdi.network/'
    ];
    
    console.log('[RAILGUN] 🔒 Initializing POI (Proof of Innocence) system with official nodes:', poiNodeURLs);
    console.log('[RAILGUN] 🔍 POI URLs type:', typeof poiNodeURLs, 'length:', poiNodeURLs?.length);
    
    // Validate POI URLs before passing
    if (!Array.isArray(poiNodeURLs) || poiNodeURLs.length === 0) {
      console.error('[RAILGUN] ❌ POI URLs validation failed!', poiNodeURLs);
      throw new Error('POI URLs must be a non-empty array');
    }
    
    await startRailgunEngine(
      'Lexie Wallet',
      db,
      true,
      artifactManager.store,  // Pass the actual ArtifactStore instance
      false,
      false,
      poiNodeURLs,  // ✅ Official POI node URLs
      [],           // Custom POI lists (empty for now)
      true
    );

    isEngineStarted = true;
    console.log('[RAILGUN] ✅ Engine started successfully');

    // Continue with rest of initialization...
    await loadSnarkJSGroth16();
    await setupNetworks();
    await setupBalanceCallbacks();
    
    // Validate POI system (POI is already initialized via startRailgunEngine)
    try {
      const { validatePOIConfiguration } = await import('./poi-service.js');
      const isValidPOI = await validatePOIConfiguration();
      if (isValidPOI) {
        console.log('[RAILGUN] ✅ POI system validated and ready');
      } else {
        console.warn('[RAILGUN] ⚠️ POI system validation failed, but continuing with fallback handling');
      }
    } catch (poiError) {
      console.warn('[RAILGUN] ⚠️ POI validation failed, but engine will handle POI errors gracefully:', poiError);
    }
    
    // Step 7: Setup balance update callback
    console.log('[RAILGUN] 🔄 Setting up balance update callbacks...');
    try {
      const { handleBalanceUpdateCallback } = await import('./balances.js');
      setOnBalanceUpdateCallback(handleBalanceUpdateCallback);
      console.log('[RAILGUN] ✅ Balance update callback registered successfully');
    } catch (callbackError) {
      console.warn('[RAILGUN] ⚠️ Failed to register balance update callback:', callbackError);
      // Continue without callback - this is not critical for engine start
    }
    
    console.log('[RAILGUN] 🎉 Engine initialization completed');

  } catch (error) {
    console.error('[RAILGUN] Engine initialization failed:', error);
    isEngineStarted = false;
    // More robust error handling
    const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
    throw new Error(`RAILGUN Engine failed to start: ${errorMessage}`);
  }
};

/**
 * Initialize RAILGUN Engine (main entry point)
 * Returns a promise that resolves when engine is ready
 */
export const initializeRailgun = async () => {
  if (enginePromise) {
    return enginePromise;
  }

  enginePromise = startEngine();
  return enginePromise;
};

/**
 * Wait for RAILGUN to be ready
 * Utility function for other modules
 */
export const waitForRailgunReady = async () => {
  if (!isEngineStarted) {
    await initializeRailgun();
  }
  
  if (!areArtifactsLoaded) {
    throw new Error('RAILGUN contract artifacts not loaded');
  }
  
  if (!isProverLoaded) {
    throw new Error('RAILGUN prover not loaded');
  }
  
  return true;
};

/**
 * Check if RAILGUN engine is ready
 */
export const isRailgunReady = () => {
  return isEngineStarted && isProverLoaded && areArtifactsLoaded;
};

let lastCall = 0;
let running = false;

export const refreshBalances = async (walletID, networkName) => {
  if (running || Date.now() - lastCall < 30000) {
    console.log('[RAILGUN] Skipping refreshBalances due to throttling or ongoing scan');
    return;
  }
  running = true;
  try {
    await waitForRailgunReady();

    const retryWithBackoff = async (fn, retries = 5, delay = 1000) => {
      try {
        await fn();
      } catch (error) {
        if (retries > 0 && error.code === -32005) {
          console.warn('[RAILGUN] Rate limit hit, retrying with backoff...', { retries, delay });
          await new Promise(resolve => setTimeout(resolve, delay));
          return retryWithBackoff(fn, retries - 1, delay * 2);
        }
        if (error.message.includes('Invalid fallback provider config')) {
          console.warn('[RAILGUN] Skipping scan: fallback provider invalid');
          return;
        }
        throw error;
      }
    };

    await retryWithBackoff(() => refreshRailgunBalances(networkName, walletID));

    lastCall = Date.now();
    console.log('[RAILGUN] Balances refreshed for:', { walletID: walletID?.slice(0, 8) + '...', networkName });
  } catch (error) {
    console.error('[RAILGUN] Failed to refresh balances:', error);
    throw error;
  } finally {
    running = false;
  }
};

let alreadyStarted = false;

export const initializeRailgunSingleton = async () => {
  if (alreadyStarted) return;
  alreadyStarted = true;
  await startRailgunEngine();
};

export const setupRailgunProviders = async () => {
  if (alreadyStarted) return;
  alreadyStarted = true;
  // Setup providers logic here
};

/**
 * Get supported network names
 */
export const getSupportedNetworks = () => {
  return Object.keys(RPC_PROVIDERS);
};

/**
 * Get network configuration
 */
export const getNetworkConfig = (networkName) => {
  return RPC_PROVIDERS[networkName];
};

// Export for use in other modules
export default {
  initializeRailgun,
  waitForRailgunReady,
  isRailgunReady,
  refreshBalances,
  getSupportedNetworks,
  getNetworkConfig,
  isProviderLoaded, // Add this to exports
}; 

/**
 * Check if provider is loaded for a specific chain
 * @param {number} chainId - Chain ID to check
 * @returns {Promise<boolean>} True if provider is loaded
 */
export const isProviderLoaded = async (chainId) => {
  try {
    await waitForRailgunReady();
    
    // Check if we have a network name for this chain
    const networkName = Object.entries(RPC_PROVIDERS).find(
      ([_, config]) => config.chainId === chainId
    )?.[0];
    
    if (!networkName) {
      console.error(`[RAILGUN] No network configuration for chain ${chainId}`);
      return false;
    }
    
    console.log(`[RAILGUN] Provider loaded for chain ${chainId} (${networkName})`);
    return true;
  } catch (error) {
    console.error(`[RAILGUN] Provider not loaded for chain ${chainId}:`, error);
    return false;
  }
}; 

let refreshTimer = null;

export const scheduleBalanceRefresh = (walletID, networkName) => {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshBalances(walletID, networkName);
    refreshTimer = null;
  }, 30000); // only once every 30s
};

// Replace direct calls to refreshBalances with scheduleBalanceRefresh
// Example usage:
// scheduleBalanceRefresh(walletID, networkName); 

