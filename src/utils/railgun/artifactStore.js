/**
 * Railgun Artifact Store Implementation
 * Provides persistent storage for ZK circuit files using localforage (IndexedDB)
 */

import localforage from 'localforage';
import { ArtifactStore } from '@railgun-community/wallet';

// Configure localforage for artifact storage
const artifactStorage = localforage.createInstance({
  name: 'railgun-artifacts',
  storeName: 'artifacts',
  description: 'Storage for Railgun ZK circuit artifacts',
});

/**
 * Creates and returns an ArtifactStore instance for Railgun
 * This handles downloading and caching of large circuit files (WASM, zkey files)
 * 
 * @returns {ArtifactStore} Configured artifact store
 */
export const createArtifactStore = () => {
  return new ArtifactStore(
    // getFile: Retrieve a file from storage
    async (path) => {
      try {
        const data = await artifactStorage.getItem(path);
        if (data) {
          console.debug(`[ArtifactStore] Retrieved artifact: ${path}`);
          return data;
        }
        return null;
      } catch (error) {
        console.error(`[ArtifactStore] Error retrieving artifact ${path}:`, error);
        return null;
      }
    },

    // storeFile: Store a downloaded artifact file
    async (dir, path, item) => {
      try {
        // Use path as the key (dir is included in path)
        await artifactStorage.setItem(path, item);
        console.debug(`[ArtifactStore] Stored artifact: ${path}, size: ${getItemSize(item)}`);
      } catch (error) {
        console.error(`[ArtifactStore] Error storing artifact ${path}:`, error);
        throw error;
      }
    },

    // fileExists: Check if an artifact file already exists
    async (path) => {
      try {
        const data = await artifactStorage.getItem(path);
        const exists = data !== null;
        console.debug(`[ArtifactStore] Artifact ${path} exists: ${exists}`);
        return exists;
      } catch (error) {
        console.error(`[ArtifactStore] Error checking artifact existence ${path}:`, error);
        return false;
      }
    }
  );
};

/**
 * Utility function to get the size of an item for logging
 * @param {string|Buffer|Uint8Array} item - The item to measure
 * @returns {string} Human-readable size
 */
const getItemSize = (item) => {
  if (!item) return '0 B';
  
  let bytes;
  if (typeof item === 'string') {
    bytes = new Blob([item]).size;
  } else if (item instanceof ArrayBuffer) {
    bytes = item.byteLength;
  } else if (item.length !== undefined) {
    bytes = item.length;
  } else {
    bytes = JSON.stringify(item).length;
  }

  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round(bytes / Math.pow(1024, i) * 100) / 100} ${sizes[i]}`;
};

/**
 * Utility functions for managing artifacts
 */

// Clear all stored artifacts (useful for debugging or clearing cache)
export const clearArtifacts = async () => {
  try {
    await artifactStorage.clear();
    console.log('[ArtifactStore] Cleared all artifacts');
  } catch (error) {
    console.error('[ArtifactStore] Error clearing artifacts:', error);
    throw error;
  }
};

// Get list of all stored artifacts
export const listArtifacts = async () => {
  try {
    const keys = await artifactStorage.keys();
    console.log('[ArtifactStore] Stored artifacts:', keys);
    return keys;
  } catch (error) {
    console.error('[ArtifactStore] Error listing artifacts:', error);
    return [];
  }
};

// Get total size of stored artifacts
export const getArtifactStorageSize = async () => {
  try {
    const keys = await artifactStorage.keys();
    let totalSize = 0;
    
    for (const key of keys) {
      const item = await artifactStorage.getItem(key);
      if (item) {
        if (typeof item === 'string') {
          totalSize += new Blob([item]).size;
        } else if (item instanceof ArrayBuffer) {
          totalSize += item.byteLength;
        } else if (item.length !== undefined) {
          totalSize += item.length;
        }
      }
    }
    
    return {
      bytes: totalSize,
      formatted: getItemSize({ length: totalSize }),
      artifactCount: keys.length,
    };
  } catch (error) {
    console.error('[ArtifactStore] Error calculating storage size:', error);
    return { bytes: 0, formatted: '0 B', artifactCount: 0 };
  }
};

export default createArtifactStore; 