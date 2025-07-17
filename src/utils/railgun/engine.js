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

    const providerConfig = {
      chainId,
      providers: [
        { provider: rpcUrl, priority: 1, weight: 1 },
      ]
    };

    const { feesSerialized } = await loadProvider(
      providerConfig,
      networkName,
      pollingInterval
    );

    loadedNetworks.add(networkName);
    
    console.log(`[Railgun] Provider loaded for ${networkName}`);
    console.log(`[Railgun] Fees for ${networkName}:`, feesSerialized);

    return { feesSerialized };
  } catch (error) {
    console.error(`[Railgun] Failed to load provider for ${networkName}:`, error);
    throw error;
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
    { name: NetworkName.BNBChain, chainId: 56, rpcUrl: RPC_URLS.bsc },
    { name: NetworkName.EthereumSepolia_DEPRECATED, chainId: 11155111, rpcUrl: RPC_URLS.sepolia },
  ];

  const results = [];
  
  for (const config of networkConfigs) {
    try {
      const result = await loadNetworkProvider(config.name, config.chainId, config.rpcUrl);
      results.push({ ...config, success: true, result });
    } catch (error) {
      console.warn(`Failed to load ${config.name}:`, error.message);
      results.push({ ...config, success: false, error: error.message });
    }
  }

  return results;
};

/**
 * Set up balance update callback
 * @param {Function} callback - Callback function to handle balance updates
 */
export const setBalanceUpdateCallback = (callback) => {
  balanceUpdateCallback = callback;
  setOnBalanceUpdateCallback(callback);
  console.log('[Railgun] Balance update callback registered');
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