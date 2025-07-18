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

import { 
  startRailgunEngine,
  setLoggers,
  loadProvider,
  getProver,
  setOnBalanceUpdateCallback,
  setOnUTXOMerkletreeHistoryCallback,
  refreshRailgunBalances,
} from '@railgun-community/wallet';
import { 
  NetworkName,
  NETWORK_CONFIG,
  isDefined,
} from '@railgun-community/shared-models';
import { createArtifactStore } from './artifactStore.js';

// Engine state
let isEngineStarted = false;
let isProverLoaded = false;
let enginePromise = null;

/**
 * Alchemy RPC Configuration
 * Using official Alchemy RPC endpoints
 */
const ALCHEMY_API_KEY = import.meta.env.VITE_ALCHEMY_API_KEY || 'demo'; // Use demo key as fallback

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
 * Debug logger setup
 * Following Step 5 of the documentation
 */
const setupLogger = () => {
  const logger = {
    log: (message, data) => {
      console.log(`[RAILGUN] ${message}`, data || '');
    },
    warn: (message, data) => {
      console.warn(`[RAILGUN WARNING] ${message}`, data || '');
    },
    error: (message, data) => {
      console.error(`[RAILGUN ERROR] ${message}`, data || '');
    },
  };

  setLoggers(logger, logger, logger); // Set for all log levels
  console.log('[RAILGUN] Debug logger configured');
};

/**
 * Load Groth16 Prover for browser platform
 * Following Step 3 of the documentation
 */
const loadProver = async () => {
  if (isProverLoaded) {
    console.log('[RAILGUN] Prover already loaded');
    return;
  }

  try {
    console.log('[RAILGUN] Loading Groth16 prover for browser...');
    
    // Load the browser prover
    const prover = await getProver();
    if (!prover) {
      throw new Error('Failed to get prover instance');
    }

    console.log('[RAILGUN] Groth16 prover loaded successfully');
    isProverLoaded = true;
  } catch (error) {
    console.error('[RAILGUN] Failed to load prover:', error);
    throw new Error(`Prover loading failed: ${error.message}`);
  }
};

/**
 * Add networks and RPC providers
 * Following Step 4 of the documentation
 */
const setupNetworks = async () => {
  try {
    console.log('[RAILGUN] Setting up networks and RPC providers...');

    // Load providers for each supported network
    for (const [networkName, config] of Object.entries(RPC_PROVIDERS)) {
      try {
        console.log(`[RAILGUN] Loading provider for ${networkName}...`);
        
        await loadProvider(
          config.rpcUrl,
          networkName,
          config.chainId
        );
        
        console.log(`[RAILGUN] Provider loaded for ${networkName}: ${config.rpcUrl}`);
      } catch (error) {
        console.error(`[RAILGUN] Failed to load provider for ${networkName}:`, error);
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

  // UTXO Merkletree history callback
  setOnUTXOMerkletreeHistoryCallback((merkletreeUpdate) => {
    console.log('[RAILGUN] Merkletree updated:', {
      networkName: merkletreeUpdate.networkName,
      treeNumber: merkletreeUpdate.treeNumber,
      startPosition: merkletreeUpdate.startPosition,
      endPosition: merkletreeUpdate.endPosition,
    });
    
    // Dispatch custom event for UI to listen to
    window.dispatchEvent(new CustomEvent('railgun-merkletree-update', {
      detail: merkletreeUpdate
    }));
  });

  console.log('[RAILGUN] Balance callbacks configured');
};

/**
 * Start RAILGUN Engine
 * Following Step 1 of the documentation
 */
const startEngine = async () => {
  if (isEngineStarted) {
    console.log('[RAILGUN] Engine already started');
    return;
  }

  try {
    console.log('[RAILGUN] Starting RAILGUN Privacy Engine...');

    // Step 2: Create artifact store
    const artifactStore = createArtifactStore();
    console.log('[RAILGUN] Artifact store created');

    // Step 5: Setup debug logger
    setupLogger();

    // Step 1: Start the engine
    const walletSource = 'Lexie Wallet'; // Identify our wallet implementation
    const shouldDebug = import.meta.env.DEV;
    
    await startRailgunEngine(
      walletSource,
      artifactStore,
      shouldDebug,
      undefined, // skipMerkletreeScans - let it scan normally
      undefined  // poiNodeInterface - not using POI initially
    );

    isEngineStarted = true;
    console.log('[RAILGUN] Privacy Engine started successfully');

    // Step 3: Load prover
    await loadProver();

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