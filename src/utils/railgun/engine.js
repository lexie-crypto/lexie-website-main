/**
 * Railgun Engine Initialization and Management
 * Handles starting the Railgun engine, loading network providers, and ZK prover setup
 */

import { 
  startRailgunEngine, 
  loadProvider, 
  getProver, 
  setLoggers,
  setOnBalanceUpdateCallback,
  setOnUTXOMerkletreeScanCallback,
  setOnTXIDMerkletreeScanCallback,
} from '@railgun-community/wallet';
import { NetworkName, NETWORK_CONFIG } from '@railgun-community/shared-models';
import { groth16 } from 'snarkjs';
import LevelJS from 'level-js';

import { createArtifactStore } from './artifactStore.js';
import { RAILGUN_CONFIG, POI_CONFIG, RPC_URLS } from '../../config/environment.js';

// Engine state
let isEngineInitialized = false;
let isProverLoaded = false;
let loadedNetworks = new Set();

// Callbacks for engine events
let balanceUpdateCallback = null;
let scanProgressCallbacks = new Set();

/**
 * Wait for Railgun engine to be ready
 * Blocks all Railgun balance and transaction calls until engine is initialized
 */
export const waitForRailgunReady = async () => {
  let retries = 20;
  while (!getEngineStatus().isInitialized && retries > 0) {
    await new Promise(res => setTimeout(res, 300));
    retries--;
  }
  if (!getEngineStatus().isInitialized) {
    throw new Error("Railgun engine did not initialize");
  }
};

/**
 * Initialize the Railgun engine
 * This must be called before any Railgun operations
 */
export const initializeRailgunEngine = async () => {
  if (isEngineInitialized) {
    console.log('[Railgun] Engine already initialized');
    return true;
  }

  try {
    console.log('[Railgun] Initializing engine...');

    // Create database instance
    const db = new LevelJS(RAILGUN_CONFIG.dbName);
    
    // Create artifact store
    const artifactStore = createArtifactStore();

    // Set up logging
    if (RAILGUN_CONFIG.debug) {
      setLoggers(
        (message) => console.log(`[Railgun] ${message}`),
        (error) => console.error(`[Railgun] ${error}`)
      );
    }

    // Start the engine
    await startRailgunEngine(
      RAILGUN_CONFIG.walletSourceName,      // walletSource
      db,                                   // db
      RAILGUN_CONFIG.debug,                 // shouldDebug
      artifactStore,                        // artifactStore
      RAILGUN_CONFIG.useNativeArtifacts,    // useNativeArtifacts
      RAILGUN_CONFIG.skipMerkletreeScans,   // skipMerkletreeScans
      POI_CONFIG.aggregatorUrls,            // poiNodeUrls
      POI_CONFIG.customPOILists,           // customPOILists
      RAILGUN_CONFIG.verboseScanLogging     // verboseScanLogging
    );

    isEngineInitialized = true;
    console.log('[Railgun] Engine initialized successfully');

    // Load ZK prover
    await loadSnarkJSGroth16();

    return true;
  } catch (error) {
    console.error('[Railgun] Failed to initialize engine:', error);
    isEngineInitialized = false;
    throw error;
  }
};

/**
 * Load and register the snarkJS Groth16 prover
 */
export const loadSnarkJSGroth16 = async () => {
  if (isProverLoaded) {
    console.log('[Railgun] Prover already loaded');
    return;
  }

  try {
    console.log('[Railgun] Loading snarkJS Groth16 prover...');
    
    // Register the Groth16 prover with Railgun
    getProver().setSnarkJSGroth16(groth16);
    
    isProverLoaded = true;
    console.log('[Railgun] snarkJS Groth16 prover loaded successfully');
  } catch (error) {
    console.error('[Railgun] Failed to load prover:', error);
    throw error;
  }
};

/**
 * Load a network provider for Railgun
 * @param {string} networkName - Network name from NetworkName enum
 * @param {number} chainId - Chain ID
 * @param {string} rpcUrl - RPC URL for the network
 * @param {number} pollingInterval - Polling interval in milliseconds (default: 5 minutes)
 */
export const loadNetworkProvider = async (networkName, chainId, rpcUrl, pollingInterval = 5 * 60 * 1000) => {
  if (!isEngineInitialized) {
    throw new Error('Railgun engine must be initialized before loading providers');
  }

  if (loadedNetworks.has(networkName)) {
    console.log(`[Railgun] Provider for ${networkName} already loaded`);
    return;
  }

  try {
    console.log(`[Railgun] Loading provider for ${networkName} (Chain ID: ${chainId})`);
    console.log(`[Railgun] RPC URL: ${rpcUrl}`);

    // Check if RPC URL is valid
    if (!rpcUrl || rpcUrl.includes('undefined') || rpcUrl.includes('demo')) {
      console.warn(`[Railgun] Skipping ${networkName} - invalid or demo RPC URL: ${rpcUrl}`);
      return { success: false, error: 'Invalid RPC URL' };
    }

    // Chain-specific Ankr fallback endpoints with API key
    const fallbackMap = {
      1: 'https://rpc.ankr.com/eth/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
      137: 'https://rpc.ankr.com/polygon/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
      42161: 'https://rpc.ankr.com/arbitrum/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
      10: 'https://rpc.ankr.com/optimism/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
      56: 'https://rpc.ankr.com/bsc/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
      11155111: 'https://rpc.ankr.com/eth_sepolia/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
    };

    const ankrFallbackUrl = fallbackMap[chainId];
    
    if (!ankrFallbackUrl) {
      console.warn(`[Railgun] No Ankr fallback available for chain ${chainId}`);
      return { success: false, error: `Unsupported chain ID: ${chainId}` };
    }

    const providerConfig = {
      chainId,
      providers: [
        {
          provider: rpcUrl,
          priority: 1,
          weight: 2,
        },
        {
          provider: ankrFallbackUrl,
          priority: 2,
          weight: 1,
        },
      ],
    };

    console.log(`[Railgun] Provider config for ${networkName}:`, {
      chainId,
      primaryRPC: rpcUrl,
      fallbackRPC: ankrFallbackUrl,
      providerCount: providerConfig.providers.length,
    });

    // Validate configuration before attempting to load
    if (!providerConfig.chainId || !providerConfig.providers || providerConfig.providers.length === 0) {
      console.error(`[Railgun] Invalid provider config for ${networkName}:`, providerConfig);
      return { success: false, error: 'Invalid provider configuration' };
    }

    console.log(`[Railgun] Attempting to load provider for ${networkName}...`);
    
    const { feesSerialized } = await loadProvider(
      providerConfig,
      networkName,
      pollingInterval
    );

    loadedNetworks.add(networkName);
    
    console.log(`[Railgun] ✅ Provider loaded successfully for ${networkName}`);
    console.log(`[Railgun] Fees for ${networkName}:`, feesSerialized);

    return { success: true, feesSerialized };
  } catch (error) {
    console.error(`[Railgun] ❌ Failed to load provider for ${networkName}:`, error);
    console.error(`[Railgun] Error details:`, {
      networkName,
      chainId,
      error: error.message,
      stack: error.stack,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Load all supported network providers
 */
export const loadAllNetworkProviders = async () => {
  const networkConfigs = [
    { name: NetworkName.Ethereum, chainId: 1, rpcUrl: RPC_URLS.ethereum },
    { name: NetworkName.Polygon, chainId: 137, rpcUrl: RPC_URLS.polygon },
    { name: NetworkName.Arbitrum, chainId: 42161, rpcUrl: RPC_URLS.arbitrum },
    { name: NetworkName.Optimism, chainId: 10, rpcUrl: RPC_URLS.optimism },
    { name: NetworkName.BNBChain, chainId: 56, rpcUrl: RPC_URLS.bsc },
    { name: NetworkName.EthereumSepolia_DEPRECATED, chainId: 11155111, rpcUrl: RPC_URLS.sepolia },
  ];

  const results = [];
  let successCount = 0;
  let failureCount = 0;
  
  console.log(`[Railgun] Loading ${networkConfigs.length} network providers...`);
  
  for (const config of networkConfigs) {
    try {
      console.log(`[Railgun] Loading ${config.name}...`);
      const result = await loadNetworkProvider(config.name, config.chainId, config.rpcUrl);
      
      if (result.success) {
        successCount++;
        console.log(`[Railgun] ✅ ${config.name} loaded successfully`);
      } else {
        failureCount++;
        console.warn(`[Railgun] ⚠️ ${config.name} failed to load: ${result.error}`);
      }
      
      results.push({ 
        ...config, 
        success: result.success, 
        error: result.error,
        result: result.success ? result : null 
      });
    } catch (error) {
      failureCount++;
      console.error(`[Railgun] ❌ ${config.name} failed with exception:`, error.message);
      results.push({ 
        ...config, 
        success: false, 
        error: error.message,
        result: null 
      });
    }
  }

  console.log(`[Railgun] Network provider loading complete:`, {
    total: networkConfigs.length,
    successful: successCount,
    failed: failureCount,
    successRate: `${Math.round((successCount / networkConfigs.length) * 100)}%`
  });

  // Log detailed results
  results.forEach(result => {
    const status = result.success ? '✅' : '❌';
    console.log(`[Railgun] ${status} ${result.name} (Chain ${result.chainId}): ${result.success ? 'SUCCESS' : result.error}`);
  });

  return results;
};

/**
 * Set up balance update callback
 * @param {Function} callback - Callback function to handle balance updates
 */
export const setBalanceUpdateCallback = (callback) => {
  balanceUpdateCallback = callback;
  
  // Wrap the callback with enhanced logging
  const wrappedCallback = (balanceEvent) => {
    console.log('[RAILGUN] Private balance callback triggered:', balanceEvent);
    console.log('[RAILGUN] Balance event details:', {
      railgunWalletID: balanceEvent.railgunWalletID,
      balanceBucket: balanceEvent.balanceBucket,
      chain: balanceEvent.chain,
      tokenCount: balanceEvent.erc20Amounts?.length || 0,
      tokens: balanceEvent.erc20Amounts?.map(token => ({ 
        address: token.tokenAddress, 
        amount: token.amount.toString() 
      })) || [],
    });
    
    // Call the original callback
    if (callback) {
      try {
        callback(balanceEvent);
        console.log('[RAILGUN] Balance callback executed successfully');
      } catch (error) {
        console.error('[RAILGUN] Error in balance callback:', error);
      }
    } else {
      console.warn('[RAILGUN] No balance callback function provided');
    }
  };
  
  setOnBalanceUpdateCallback(wrappedCallback);
  console.log('[Railgun] Balance update callback registered with enhanced logging');
};

/**
 * Set up scan progress callbacks
 * @param {Function} utxoCallback - Callback for UTXO scan progress
 * @param {Function} txidCallback - Callback for TXID scan progress
 */
export const setScanProgressCallbacks = (utxoCallback, txidCallback) => {
  if (utxoCallback) {
    setOnUTXOMerkletreeScanCallback(utxoCallback);
    scanProgressCallbacks.add(utxoCallback);
    console.log('[Railgun] UTXO scan progress callback registered');
  }
  
  if (txidCallback) {
    setOnTXIDMerkletreeScanCallback(txidCallback);
    scanProgressCallbacks.add(txidCallback);
    console.log('[Railgun] TXID scan progress callback registered');
  }
};

/**
 * Get engine status
 */
export const getEngineStatus = () => {
  return {
    isInitialized: isEngineInitialized,
    isProverLoaded,
    loadedNetworks: Array.from(loadedNetworks),
    hasBalanceCallback: !!balanceUpdateCallback,
    scanCallbackCount: scanProgressCallbacks.size,
  };
};

/**
 * Reset engine state (for testing or re-initialization)
 */
export const resetEngineState = () => {
  isEngineInitialized = false;
  isProverLoaded = false;
  loadedNetworks.clear();
  balanceUpdateCallback = null;
  scanProgressCallbacks.clear();
  console.log('[Railgun] Engine state reset');
};

/**
 * Utility to check if a network is supported and loaded
 * @param {string} networkName - Network name to check
 */
export const isNetworkLoaded = (networkName) => {
  return loadedNetworks.has(networkName);
};

/**
 * Get network name from chain ID
 * @param {number} chainId - Chain ID
 * @returns {string|null} Network name or null if not supported
 */
export const getNetworkNameFromChainId = (chainId) => {
  switch (chainId) {
    case 1: return NetworkName.Ethereum;
    case 137: return NetworkName.Polygon;
    case 42161: return NetworkName.Arbitrum;
    case 10: return NetworkName.Optimism;
    case 56: return NetworkName.BNBChain;
    case 11155111: return NetworkName.EthereumSepolia_DEPRECATED;
    default: return null;
  }
};

export default {
  initializeRailgunEngine,
  loadSnarkJSGroth16,
  loadNetworkProvider,
  loadAllNetworkProviders,
  setBalanceUpdateCallback,
  setScanProgressCallbacks,
  getEngineStatus,
  resetEngineState,
  isNetworkLoaded,
  getNetworkNameFromChainId,
  waitForRailgunReady,
}; 