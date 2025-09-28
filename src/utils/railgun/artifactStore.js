/**
 * RAILGUN Artifact Store Implementation
 * Now uses Redis backend via proxy for better performance and centralized caching
 * Based on: https://docs.railgun.org/developer-guide/wallet/getting-started/2.-build-a-persistent-store-for-artifact-downloads
 */

import { ArtifactStore } from '@railgun-community/wallet';
import { ArtifactDownloader } from './artifactDownloader.js';
import { getArtifactVariantString, getArtifactVariantStringPOI } from './artifactUtil.js';

// Legacy localforage store (kept for fallback)
const createLocalforageArtifactStore = () => {
  console.warn('[ArtifactStore] Using legacy localforage store - consider migrating to Redis');
  const localforage = require('localforage');

  // Configure localforage for RAILGUN artifacts
  const railgunStorage = localforage.createInstance({
    name: 'RailgunArtifacts',
    storeName: 'artifacts',
    description: 'RAILGUN cryptographic artifacts and proofs storage',
    driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
    version: 1.0,
    size: 50 * 1024 * 1024 // 50MB for large artifacts
  });

  console.log('[ArtifactStore] Creating legacy localforage artifact store...');
  console.log('[ArtifactStore] Using storage driver:', railgunStorage.driver());

  // Return the official ArtifactStore instance
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

// Redis-based store (default)
export const createArtifactStore = () => {
  try {
    // Try to use Redis store first
    const { createRedisArtifactStore } = require('./artifactStoreRedis.js');
    console.log('[ArtifactStore] Using Redis artifact store for better performance');
    return createRedisArtifactStore();
  } catch (error) {
    console.warn('[ArtifactStore] Redis store not available, falling back to localforage:', error.message);
    return createLocalforageArtifactStore();
  }
};

// Enhanced artifact store with integrated downloader
export const createEnhancedArtifactStore = (useNativeArtifacts = false) => {
  try {
    // Try Redis-enhanced store first
    const { createEnhancedRedisArtifactStore } = require('./artifactStoreRedis.js');
    console.log('[EnhancedArtifactStore] Using Redis-enhanced artifact store');
    return createEnhancedRedisArtifactStore({ useNativeArtifacts });
  } catch (error) {
    console.warn('[EnhancedArtifactStore] Redis store not available, using legacy localforage:', error.message);

    // Fallback to legacy localforage implementation
    const artifactStore = createLocalforageArtifactStore();
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
  }
}; 