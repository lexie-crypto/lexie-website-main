/**
 * Example: Enhanced RAILGUN Artifact Store with Official Downloader
 * Shows how to use the integrated artifact downloading capabilities
 */

import { createEnhancedArtifactStore } from './artifactStore.js';
import { getArtifactVariantString, getArtifactVariantStringPOI } from './artifactUtil.js';

// Example 1: Setup artifacts when your app starts
export const initializeRailgunArtifacts = async () => {
  console.log('[ArtifactExample] Initializing RAILGUN artifacts...');
  
  try {
    // Create enhanced artifact store (false = web/WASM, true = native)
    const artifactManager = createEnhancedArtifactStore(false);
    
    // Setup common artifacts needed for most transactions
    await artifactManager.setupCommonArtifacts();
    
    // Optional: Setup POI artifacts if you need Proof of Innocence
    // await artifactManager.setupPOIArtifacts();
    
    console.log('[ArtifactExample] RAILGUN artifacts ready!');
    return artifactManager;
    
  } catch (error) {
    console.error('[ArtifactExample] Failed to initialize artifacts:', error);
    throw error;
  }
};

// Example 2: Download specific artifacts for a transaction
export const prepareArtifactsForTransaction = async (nullifiers, commitments) => {
  console.log(`[ArtifactExample] Preparing artifacts for ${nullifiers}x${commitments} transaction`);
  
  const artifactManager = createEnhancedArtifactStore(false);
  const variantString = getArtifactVariantString(nullifiers, commitments);
  
  try {
    // Check if artifacts already exist
    const hasArtifacts = await artifactManager.hasArtifacts(variantString);
    
    if (!hasArtifacts) {
      console.log(`[ArtifactExample] Downloading artifacts for ${variantString}...`);
      await artifactManager.downloadArtifacts(variantString);
      console.log(`[ArtifactExample] Downloaded artifacts for ${variantString}`);
    } else {
      console.log(`[ArtifactExample] Artifacts for ${variantString} already available`);
    }
    
    // Get the artifacts for use in RAILGUN operations
    const artifacts = await artifactManager.getArtifacts(variantString);
    console.log(`[ArtifactExample] Retrieved artifacts:`, {
      hasVkey: !!artifacts.vkey,
      hasZkey: !!artifacts.zkey,
      hasWasm: !!artifacts.wasm,
      hasDat: !!artifacts.dat,
    });
    
    return artifacts;
    
  } catch (error) {
    console.error(`[ArtifactExample] Failed to prepare artifacts for ${variantString}:`, error);
    throw error;
  }
};

// Example 3: Setup POI artifacts
export const setupPOIArtifacts = async () => {
  console.log('[ArtifactExample] Setting up POI artifacts...');
  
  try {
    const artifactManager = createEnhancedArtifactStore(false);
    await artifactManager.setupPOIArtifacts();
    console.log('[ArtifactExample] POI artifacts ready!');
  } catch (error) {
    console.error('[ArtifactExample] Failed to setup POI artifacts:', error);
    throw error;
  }
};

// Example 4: Custom artifact management
export const downloadCustomArtifacts = async (artifactVariantString) => {
  console.log(`[ArtifactExample] Downloading custom artifacts: ${artifactVariantString}`);
  
  const artifactManager = createEnhancedArtifactStore(false);
  
  try {
    await artifactManager.downloadArtifacts(artifactVariantString);
    const artifacts = await artifactManager.getArtifacts(artifactVariantString);
    
    console.log(`[ArtifactExample] Successfully downloaded and retrieved ${artifactVariantString}`);
    return artifacts;
    
  } catch (error) {
    console.error(`[ArtifactExample] Failed to download ${artifactVariantString}:`, error);
    throw error;
  }
};

// Example usage in your app:
/*
import { initializeRailgunArtifacts, prepareArtifactsForTransaction } from './artifactExample.js';

// 1. Initialize artifacts when your app starts
const artifactManager = await initializeRailgunArtifacts();

// 2. Before creating a RAILGUN transaction, ensure artifacts are ready
const artifacts = await prepareArtifactsForTransaction(2, 2); // 2 inputs, 2 outputs

// 3. Use artifacts with your RAILGUN transactions
// The artifacts are now stored locally and will be used automatically by the RAILGUN SDK
*/ 