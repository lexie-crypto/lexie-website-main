/**
 * RAILGUN Integration - Official SDK with Enhanced Artifact Management
 * Complete RAILGUN privacy protocol integration with artifact downloading
 */

// Re-export everything you need from the official SDK
export {
  // Core engine functions
  startRailgunEngine,
  stopRailgunEngine,
  
  // Wallet management
  createRailgunWallet,
  loadWalletByID,
  unloadWalletByID,
  deleteWalletByID,
  
  // Transactions
  generateTransferProof,
  generateShieldProof,
  populateProvedTransfer,
  populateProvedShield,
  populateProvedUnshield,
  
  // Balances
  getWalletBalances,
  refreshRailgunBalances,
  
  // Cross-contract calls (DeFi integration)
  generateCrossContractCallsProof,
  populateProvedCrossContractCalls,
  gasEstimateForUnprovenCrossContractCalls,
  
  // Artifact management
  ArtifactStore,
  
  // Utilities
  getRailgunAddress,
  validateRailgunAddress,
  
} from '@railgun-community/wallet';

// Enhanced artifact management with downloading
export { 
  createArtifactStore, 
  createEnhancedArtifactStore 
} from './artifactStore.js';

// Artifact utilities
export {
  ArtifactDownloader
} from './artifactDownloader.js';

export {
  getArtifactVariantString,
  getArtifactVariantStringPOI,
  artifactDownloadsDir,
  artifactDownloadsPath,
  getArtifactDownloadsPaths,
  getArtifactUrl
} from './artifactUtil.js'; 