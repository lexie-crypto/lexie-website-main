/**
 * RAILGUN Artifact Store Implementation
 * Uses the official @railgun-community/wallet SDK with integrated downloader
 * Based on: https://docs.railgun.org/developer-guide/wallet/getting-started/2.-build-a-persistent-store-for-artifact-downloads
 */

import { ArtifactStore } from '@railgun-community/wallet';
import localforage from 'localforage';
import { ArtifactDownloader } from './artifactDownloader.js';
import { getArtifactVariantString, getArtifactVariantStringPOI } from './artifactUtil.js';

export const createArtifactStore = () => {
  // Configure localforage for RAILGUN artifacts
  const railgunStorage = localforage.createInstance({
    name: 'RailgunArtifacts',
    storeName: 'artifacts',
    description: 'RAILGUN cryptographic artifacts and proofs storage',
    driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
    version: 1.0,
    size: 50 * 1024 * 1024 // 50MB for large artifacts
  });

  console.log('[ArtifactStore] Creating RAILGUN artifact store...');
  console.log('[ArtifactStore] Using storage driver:', railgunStorage.driver());
  
  // Return the official ArtifactStore instance
  // This gives you ALL the functionality: downloading, validation, compression, etc.
  return new ArtifactStore(
    // get method
    async (path) => {
      return railgunStorage.getItem(path);
    },
    // store method
    async (dir, path, item) => {
      await railgunStorage.setItem(path, item);
    },
    // exists method
    async (path) => {
      return (await railgunStorage.getItem(path)) != null;
    }
  );
};

// Enhanced artifact store with integrated downloader
export const createEnhancedArtifactStore = (useNativeArtifacts = false) => {
  const artifactStore = createArtifactStore();
  const downloader = new ArtifactDownloader(artifactStore, useNativeArtifacts);
  
  return {
    store: artifactStore,
    downloader: downloader,
    
    // Convenience methods
    async downloadArtifacts(artifactVariantString) {
      console.log(`[EnhancedArtifactStore] Downloading artifacts for variant: ${artifactVariantString}`);
      return await downloader.downloadArtifacts(artifactVariantString);
    },
    
    async getArtifacts(artifactVariantString) {
      console.log(`[EnhancedArtifactStore] Getting artifacts for variant: ${artifactVariantString}`);
      return await downloader.getDownloadedArtifacts(artifactVariantString);
    },
    
    async hasArtifacts(artifactVariantString) {
      const { artifactDownloadsPath, ArtifactName } = await import('@railgun-community/shared-models');
      const { artifactDownloadsPath: getPath } = await import('./artifactUtil.js');
      
      const paths = [
        getPath(ArtifactName.VKEY, artifactVariantString),
        getPath(ArtifactName.ZKEY, artifactVariantString),
        getPath(useNativeArtifacts ? ArtifactName.DAT : ArtifactName.WASM, artifactVariantString),
      ];
      
      const exists = await Promise.all(paths.map(path => artifactStore.exists(path)));
      return exists.every(Boolean);
    },

    // Helper methods for common artifact variants
    async setupCommonArtifacts() {
      const commonVariants = [
        getArtifactVariantString(2, 2),   // 02x02 - small transactions
        getArtifactVariantString(8, 2),   // 08x02 - medium transactions  
        getArtifactVariantString(13, 1),  // 13x01 - large consolidation
      ];
      
      console.log('[EnhancedArtifactStore] Setting up common artifacts:', commonVariants);
      
      for (const variant of commonVariants) {
        const hasArtifacts = await this.hasArtifacts(variant);
        if (!hasArtifacts) {
          console.log(`[EnhancedArtifactStore] Downloading ${variant}...`);
          await this.downloadArtifacts(variant);
        } else {
          console.log(`[EnhancedArtifactStore] ${variant} already exists`);
        }
      }
      
      console.log('[EnhancedArtifactStore] Common artifacts setup complete');
    },

    async setupPOIArtifacts() {
      const poiVariants = [
        getArtifactVariantStringPOI(3, 3),   // POI_3x3
        getArtifactVariantStringPOI(13, 13), // POI_13x13
      ];
      
      console.log('[EnhancedArtifactStore] Setting up POI artifacts:', poiVariants);
      
      for (const variant of poiVariants) {
        const hasArtifacts = await this.hasArtifacts(variant);
        if (!hasArtifacts) {
          console.log(`[EnhancedArtifactStore] Downloading POI ${variant}...`);
          await this.downloadArtifacts(variant);
        } else {
          console.log(`[EnhancedArtifactStore] POI ${variant} already exists`);
        }
      }
      
      console.log('[EnhancedArtifactStore] POI artifacts setup complete');
    }
  };
}; 