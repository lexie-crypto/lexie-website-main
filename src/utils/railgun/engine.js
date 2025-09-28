/**
 * RAILGUN Engine Setup - ZERO-DELAY POI EDITION
 * Following official docs: https://docs.railgun.org/developer-guide/wallet/getting-started
 * 
 * Implements:
 * - Step 0: Patch RAILGUN SDK to use Zero-Delay POI contracts
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
// LevelJS removed - now using Redis-only adapter
import { createEnhancedArtifactStore } from './artifactStore.js';

// 🚀 ZERO-DELAY POI: Import contract address configuration
import { 
  patchRailgunForZeroDelay, 
  verifyZeroDelayConfiguration,
  getArbitrumZeroDelayAddresses,
  getLocalhostZeroDelayAddresses 
} from './lexie-integration-patch.js';

// Engine state
let isEngineStarted = false;
let isProverLoaded = false;
let areArtifactsLoaded = false;
let enginePromise = null;

/**
 * RPC Configuration via proxied endpoints
 * All RPC traffic goes through /api/rpc to avoid exposing API keys in the browser.
 */
const RPC_PROVIDERS = {
  [NetworkName.Ethereum]: {
    chainId: 1,
    rpcUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=auto',
    ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=ankr',
  },
  [NetworkName.Arbitrum]: {
    chainId: 42161, 
    rpcUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=auto',
    ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=ankr',
  },
  [NetworkName.Polygon]: {
    chainId: 137,
    rpcUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=auto',
    ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=ankr',
  },
  [NetworkName.BNBChain]: {
    chainId: 56,
    rpcUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=auto',
    ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=ankr',
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
        
        // Step 2: Then load the provider - FIXED: Use official SDK format with Ankr fallback
        const providerConfig = {
          chainId: config.chainId,
          providers: [
            {
              provider: config.rpcUrl,    // Primary: Alchemy
              priority: 2,
              weight: 1,
              maxLogsPerBatch: 5,
              stallTimeout: 2500,
            },
            {
              provider: config.ankrUrl,   // Fallback: Ankr
              priority: 1,
              weight: 1,                  // Slightly lower weight for fallback
              maxLogsPerBatch: 10,        // Higher batch size for Ankr
              stallTimeout: 3000,         // Slightly higher timeout
            }
          ]
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
 * Following the private balances documentation and official SDK patterns
 */
const setupBalanceCallbacks = async () => {
  console.log('[RAILGUN] 🔧 Setting up comprehensive balance and scanning callbacks...');
  
  // ✅ Initialize comprehensive scanning service with official SDK callbacks
  // This handles: setOnBalanceUpdateCallback, setOnUTXOMerkletreeScanCallback, setOnTXIDMerkletreeScanCallback
  // And dispatches 'railgun-balance-update' events for the useBalances hook
  const { setupScanningCallbacks } = await import('./scanning-service.js');
  setupScanningCallbacks();

  console.log('[RAILGUN] ✅ Comprehensive balance and scanning callbacks configured via scanning service');
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
    console.log('[RAILGUN] 🚀 Initializing Zero-Delay POI Railgun engine...');

    // Step 0: 🚀 PATCH RAILGUN SDK FOR ZERO-DELAY CONTRACTS
    console.log('[RAILGUN] 🔧 Step 0: Configuring Zero-Delay POI contract addresses...');
    
    // Determine which addresses to use based on environment
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const zeroDelayAddresses = isLocalhost 
      ? getLocalhostZeroDelayAddresses()
      : getArbitrumZeroDelayAddresses();
    
    // Patch the RAILGUN SDK to use Zero-Delay contracts
    const patchSuccess = await patchRailgunForZeroDelay(zeroDelayAddresses, NETWORK_CONFIG);
    if (!patchSuccess) {
      throw new Error('Failed to patch RAILGUN SDK for Zero-Delay POI contracts');
    }
    
    // Verify configuration
    verifyZeroDelayConfiguration(NETWORK_CONFIG);
    console.log('[RAILGUN] ✅ Zero-Delay POI contracts configured successfully');

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
    const { createRedisOnlyAdapter } = await import('./redis-only-adapter.js');
    const db = await createRedisOnlyAdapter('railgun-engine-redis');
    
    // Step 3: Set up logging
    setLoggers(
      (message) => console.log(`🔍 [RAILGUN:LOG] ${message}`),
      (error) => console.error(`🚨 [RAILGUN:ERROR] ${error}`)
    );

    console.log('[RAILGUN] ✅ Debug loggers configured');

    // Step 4: Start engine WITH Zero-Delay POI integration
    // 🚀 ZERO-DELAY POI: Enhanced real-time compliance without delays
    const poiNodeURLs = [
      'https://ppoi.fdi.network/',
    ]; // ← Official POI nodes for Zero-Delay enhanced validation
    
    console.log('[RAILGUN] 🚀 Starting Zero-Delay POI system - enhanced compliance with instant spendability');
    console.log('[RAILGUN] ⚡ Zero-Delay POI active: Real-time sanctions checking + instant spendability');
    
    await startRailgunEngine(
      'lexiepay',
      db,
      true,
      artifactManager.store,  // Pass the actual ArtifactStore instance
      false,
      false,
      poiNodeURLs,  // ✅ Official POI node URLs for enhanced validation
      [],           // Custom POI lists (empty for now)
      true
    );

    isEngineStarted = true;
    console.log('[RAILGUN] ✅ Engine started successfully');

    // Continue with rest of initialization...
    await loadSnarkJSGroth16();
    await setupNetworks();
    await setupBalanceCallbacks();
    
    // Zero-Delay POI system is now active with enhanced real-time validation
    console.log('[RAILGUN] ⚡ Zero-Delay POI validation active - enhanced compliance with instant spendability');
    
    // Step 7: Initialize centralized SDK callbacks to prevent duplicates
    console.log('[RAILGUN] 🔄 Initializing centralized SDK callbacks...');
    try {
      const { initializeSDKCallbacks } = await import('./sdk-callbacks.js');
      await initializeSDKCallbacks();
      console.log('[RAILGUN] ✅ Centralized SDK callbacks initialized successfully');
    } catch (callbackError) {
      console.warn('[RAILGUN] ⚠️ Failed to initialize SDK callbacks:', callbackError);
      // Continue without callbacks - this is not critical for engine start
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

/**
 * Refresh balances for a specific wallet and network
 */
export const refreshBalances = async (walletID, networkName) => {
  try {
    await waitForRailgunReady();
    await refreshRailgunBalances(networkName, walletID);
    console.log('[RAILGUN] Balances refreshed for:', { walletID: walletID?.slice(0, 8) + '...', networkName });
  } catch (error) {
    console.error('[RAILGUN] Failed to refresh balances:', error);
    throw error;
  }
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

