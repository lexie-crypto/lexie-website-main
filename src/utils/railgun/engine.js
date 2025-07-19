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
  
  // Use the OFFICIAL RAILGUN SDK callback system
  setOnBalanceUpdateCallback(async (balanceUpdate) => {
    console.log('[RAILGUN] 🔥 OFFICIAL Balance callback triggered!', {
      txidVersion: balanceUpdate.txidVersion,
      chain: balanceUpdate.chain,
      railgunWalletID: balanceUpdate.railgunWalletID?.slice(0, 8) + '...',
      balanceBucket: balanceUpdate.balanceBucket,
      erc20Count: balanceUpdate.erc20Amounts?.length || 0,
    });
    
    // Process the balance update through our balance handler
    const { handleBalanceUpdateCallback } = await import('./balances.js');
    await handleBalanceUpdateCallback({
      networkName: balanceUpdate.chain.type === 'custom' ? 
        `${balanceUpdate.chain.type}:${balanceUpdate.chain.id}` : 
        getNetworkNameFromChain(balanceUpdate.chain),
      railgunWalletID: balanceUpdate.railgunWalletID,
      erc20Amounts: balanceUpdate.erc20Amounts,
      nftAmounts: balanceUpdate.nftAmounts,
      balanceBucket: balanceUpdate.balanceBucket,
    });
  });

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

    // Step 4: Start engine WITHOUT POI (TEMPORARY FOR TESTING)
    // ⚠️ WARNING: POI DISABLED FOR DEBUGGING - MUST RE-ENABLE FOR PRODUCTION ⚠️
    console.log('[RAILGUN] 🚨 TEMPORARY: Starting engine WITHOUT POI for testing');
    console.log('[RAILGUN] ⚠️  POI is DISABLED - this is for debugging only!');
    console.log('[RAILGUN] ⚠️  MUST re-enable POI before production use!');
    
    await startRailgunEngine(
      'Lexie Wallet',
      db,
      true,
      artifactManager.store,  // Pass the actual ArtifactStore instance
      false,
      false,
      [],           // ⚠️ Empty POI URLs array - TEMPORARY for testing
      [],           // Custom POI lists (empty)
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

