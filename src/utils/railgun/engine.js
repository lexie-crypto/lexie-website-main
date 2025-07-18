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
} from '@railgun-community/shared-models';
import { groth16 } from 'snarkjs';
import LevelJS from 'level-js';
import { createArtifactStore } from './artifactStore.js';

// Engine state
let isEngineStarted = false;
let isProverLoaded = false;
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
 * Following the working implementation pattern
 */
const setupNetworks = async () => {
  try {
    console.log('[RAILGUN] Setting up networks and RPC providers...');

    // Load providers for each supported network
    for (const [networkName, config] of Object.entries(RPC_PROVIDERS)) {
      try {
        console.log(`[RAILGUN] Loading provider for ${networkName}...`);
        
        // Create provider config in the format expected by loadProvider
        const providerConfig = {
          chainId: config.chainId,
          providers: [
            {
              provider: config.rpcUrl,
              priority: 1,
              weight: 2,
            }
          ],
        };

        console.log(`[RAILGUN] Provider config for ${networkName}:`, {
          chainId: config.chainId,
          primaryRPC: config.rpcUrl,
        });

        // Load provider with correct parameters: (providerConfig, networkName, pollingInterval)
        const { feesSerialized } = await loadProvider(
          providerConfig,
          networkName,
          5 * 60 * 1000 // 5 minutes polling interval
        );
        
        console.log(`[RAILGUN] ✅ Provider loaded successfully for ${networkName}`);
        console.log(`[RAILGUN] Fees for ${networkName}:`, feesSerialized);
      } catch (error) {
        console.error(`[RAILGUN] ❌ Failed to load provider for ${networkName}:`, error);
        // Continue with other networks even if one fails
      }
    }

    console.log('[RAILGUN] Network setup completed');
  } catch (error) {
    console.error('[RAILGUN] Network setup failed:', error);
    throw error;
  }
};

/**
 * Setup balance update callbacks
 * Following the private balances documentation
 */
const setupBalanceCallbacks = () => {
  // Balance update callback
  setOnBalanceUpdateCallback((balanceUpdate) => {
    console.log('[RAILGUN] Balance updated:', {
      networkName: balanceUpdate.networkName,
      walletID: balanceUpdate.walletID?.slice(0, 8) + '...',
      balances: balanceUpdate.balancesByTokenAddress,
    });
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-balance-update', {
      detail: balanceUpdate
    }));
  });

  // UTXO Merkletree scan callback
  setOnUTXOMerkletreeScanCallback((scanData) => {
    console.log('[RAILGUN] UTXO Merkletree scan progress:', scanData);
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-utxo-scan', {
      detail: scanData
    }));
  });

  // TXID Merkletree scan callback  
  setOnTXIDMerkletreeScanCallback((scanData) => {
    console.log('[RAILGUN] TXID Merkletree scan progress:', scanData);
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-txid-scan', {
      detail: scanData
    }));
  });

  console.log('[RAILGUN] Balance callbacks configured');
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
    console.log('[RAILGUN] 🚀 Initializing Railgun engine with FULL DEBUG LOGGING...');

    // Create database instance (KEY FIX!)
    const db = new LevelJS('railgun-db');
    
    // Create artifact store
    const artifactStore = createArtifactStore();
    console.log('[RAILGUN] Artifact store created');

    // ✅ ENHANCED DEBUG LOGGING SETUP
    const railgunLogger = debug('railgun:engine');
    const railgunErrorLogger = debug('railgun:error');
    
    // Set up comprehensive Railgun logging
    setLoggers(
      (message) => {
        console.log(`🔍 [RAILGUN:LOG] ${message}`);
        railgunLogger(message);
      },
      (error) => {
        console.error(`🚨 [RAILGUN:ERROR] ${error}`);
        railgunErrorLogger(error);
      }
    );

    console.log('[RAILGUN] ✅ Debug loggers configured - all Railgun internals will be logged');

    // Start the engine with correct parameter order - PRODUCTION READY
    const walletSource = 'Lexie Wallet';
    const shouldDebug = import.meta.env.DEV;
    
    await startRailgunEngine(
      walletSource,                 // walletSource
      db,                          // db (THIS WAS MISSING!)
      shouldDebug,                 // shouldDebug  
      artifactStore,               // artifactStore
      false,                       // useNativeArtifacts
      false,                       // skipMerkletreeScans
      [],                          // poiNodeUrls
      [],                          // customPOILists
      true                         // verboseScanLogging
    );

    isEngineStarted = true;
    console.log('[RAILGUN] 🎉 Engine initialized successfully with FULL DEBUG LOGGING ACTIVE');

    // Step 3: Load prover
    await loadSnarkJSGroth16();

    // Step 4: Setup networks
    await setupNetworks();

    // Setup balance callbacks
    setupBalanceCallbacks();

    console.log('[RAILGUN] Engine initialization completed successfully');

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
  
  if (!isProverLoaded) {
    throw new Error('RAILGUN prover not loaded');
  }
  
  return true;
};

/**
 * Check if RAILGUN engine is ready
 */
export const isRailgunReady = () => {
  return isEngineStarted && isProverLoaded;
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
}; 