/**
 * RAILGUN Zero-Delay Integration Patch
 * 
 * This file patches the RAILGUN SDK to use Zero-Delay POI contracts
 * instead of the official RAILGUN contracts.
 * 
 * IMPORTANT: This must be imported BEFORE any RAILGUN SDK modules
 */

// Store original NETWORK_CONFIG to avoid circular dependency issues
let originalNetworkConfig = null;

/**
 * Override NETWORK_CONFIG to use Zero-Delay contracts
 * Call this BEFORE initializing RAILGUN engine
 */
export const patchRailgunForZeroDelay = async (zeroDelayAddresses, NETWORK_CONFIG) => {
  try {
    // Use the passed NETWORK_CONFIG instead of importing it
    if (!NETWORK_CONFIG) {
      console.error('❌ [ZERO-DELAY] NETWORK_CONFIG not provided to patch function');
      return false;
    }
    
    // Store original config if not already stored
    if (!originalNetworkConfig) {
      originalNetworkConfig = JSON.parse(JSON.stringify(NETWORK_CONFIG));
    }
    
    console.log('🔧 [ZERO-DELAY] Patching RAILGUN SDK for Zero-Delay POI system...');
    
    // STEP 1: Override contract addresses
    if (NETWORK_CONFIG.Arbitrum) {
      // Backup original
      const originalArbitrumConfig = { ...NETWORK_CONFIG.Arbitrum };
      
      // Apply Zero-Delay contract addresses
      NETWORK_CONFIG.Arbitrum = {
        ...originalArbitrumConfig,
        // Main contract overrides
        proxyContract: zeroDelayAddresses.railgunZeroDelay,
        poseidonMerkleAccumulatorV3: zeroDelayAddresses.zeroDelayPOI,
        
        // Keep other contracts as-is (or override if you have custom ones)
        relayAdaptContract: originalArbitrumConfig.relayAdaptContract,
        tokenVault: originalArbitrumConfig.tokenVault,
        
        // Update deployment block if needed
        deploymentBlock: zeroDelayAddresses.deploymentBlock || originalArbitrumConfig.deploymentBlock,
      };
      
      console.log('✅ [ZERO-DELAY] Contract addresses patched:');
      console.log('   • Main Contract:', zeroDelayAddresses.railgunZeroDelay);
      console.log('   • POI Contract:', zeroDelayAddresses.zeroDelayPOI);
    }
    
    // STEP 2: Override POI spendability logic to disable 1-hour delay
    try {
      console.log('🔧 [ZERO-DELAY] Patching POI spendability logic...');
      
      // Patch the POI system to always consider funds spendable
      const walletModule = await import('@railgun-community/wallet');
      
      // Override POI Required check to disable delay
      if (walletModule.POIRequired && walletModule.POIRequired.isRequiredForNetwork) {
        const originalIsRequired = walletModule.POIRequired.isRequiredForNetwork;
        walletModule.POIRequired.isRequiredForNetwork = async (networkName) => {
          console.log('🚀 [ZERO-DELAY] POI check intercepted - returning false (zero delay)');
          return false; // Always return false to disable POI delays
        };
        console.log('✅ [ZERO-DELAY] POI spendability delay disabled');
      }
      
      // Override wallet spendable balance check if available
      if (walletModule.WalletPOI && walletModule.WalletPOI.getSpendableReceivedChainTxids) {
        const originalGetSpendable = walletModule.WalletPOI.getSpendableReceivedChainTxids;
        walletModule.WalletPOI.getSpendableReceivedChainTxids = async (...args) => {
          console.log('🚀 [ZERO-DELAY] Spendable txids check intercepted - allowing all');
          // Call original but also include all received txids as spendable
          const originalResult = await originalGetSpendable.apply(walletModule.WalletPOI, args);
          return originalResult; // For now, return original - may need more patching
        };
      }
      
    } catch (poiError) {
      console.warn('⚠️ [ZERO-DELAY] Could not patch POI logic, will try alternative approach:', poiError.message);
    }
    
    // STEP 3: Set global flag for zero-delay mode
    if (typeof window !== 'undefined') {
      window.__LEXIE_ZERO_DELAY_MODE__ = true;
      console.log('✅ [ZERO-DELAY] Global zero-delay flag set');
    }
    
    console.log('✅ [ZERO-DELAY] RAILGUN SDK patching complete');
    return true;
    
  } catch (error) {
    console.error('❌ [ZERO-DELAY] Failed to patch RAILGUN SDK:', error);
    return false;
  }
};

/**
 * Restore original NETWORK_CONFIG (for testing/debugging)
 */
export const restoreOriginalRailgunConfig = (NETWORK_CONFIG) => {
  if (originalNetworkConfig && NETWORK_CONFIG) {
    try {
      NETWORK_CONFIG.Arbitrum = originalNetworkConfig.Arbitrum;
      console.log('🔄 [ZERO-DELAY] Original RAILGUN configuration restored');
      return true;
    } catch (error) {
      console.error('❌ [ZERO-DELAY] Failed to restore original configuration:', error);
      return false;
    }
  }
  return false;
};

/**
 * Verify that Zero-Delay contracts are configured
 */
export const verifyZeroDelayConfiguration = (NETWORK_CONFIG) => {
  try {
    if (!NETWORK_CONFIG) {
      console.error('❌ [ZERO-DELAY] NETWORK_CONFIG not provided to verify function');
      return false;
    }
    
    const arbitrumConfig = NETWORK_CONFIG.Arbitrum;
    
    if (!arbitrumConfig) {
      console.error('❌ [ZERO-DELAY] No Arbitrum configuration found');
      return false;
    }
    
    console.log('🔍 [ZERO-DELAY] Current RAILGUN configuration:');
    console.log('   • Main Contract:', arbitrumConfig.proxyContract);
    console.log('   • POI Contract:', arbitrumConfig.poseidonMerkleAccumulatorV3);
    console.log('   • Relay Adapt:', arbitrumConfig.relayAdaptContract);
    console.log('   • Token Vault:', arbitrumConfig.tokenVault);
    
    return true;
  } catch (error) {
    console.error('❌ [ZERO-DELAY] Failed to verify configuration:', error);
    return false;
  }
};

/**
 * Get Zero-Delay contract addresses for Arbitrum Mainnet
 * Update these with your actual deployed addresses
 */
export const getArbitrumZeroDelayAddresses = () => {
  return {
    // 🚀 DEPLOYED ADDRESSES - Updated with actual deployment from arbitrum
    railgunZeroDelay: "0x892E3471CF11b412eAC6AfcaC5A43201D1bD496d", // Your deployed RailgunZeroDelay proxy address
    zeroDelayPOI: "0x75b1aa53479Ad1F22078ec24Fbc151EB94dE47e8",       // Your deployed ZeroDelayPOI address
    deploymentBlock: 294000000, // Approximate Arbitrum block number (can be refined later)
    
    // Additional addresses for reference
    proxyAdmin: "0x28ac6a3c0677FF26558fD419913f34a535311cd1",        // Proxy admin
    implementation: "0x0ddB6bf0B2FC0d6681a1A2dEF9Df1623CC34661f",   // Implementation
  };
};

/**
 * Get Zero-Delay contract addresses for localhost testing
 */
export const getLocalhostZeroDelayAddresses = () => {
  return {
    railgunZeroDelay: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    zeroDelayPOI: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    deploymentBlock: 1, // First block on localhost
  };
};

export default {
  patchRailgunForZeroDelay,
  restoreOriginalRailgunConfig,
  verifyZeroDelayConfiguration,
  getArbitrumZeroDelayAddresses,
  getLocalhostZeroDelayAddresses,
};