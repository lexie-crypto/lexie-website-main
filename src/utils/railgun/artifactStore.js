/**
 * RAILGUN Artifact Store Implementation
 * Following official docs: https://docs.railgun.org/developer-guide/wallet/getting-started/2.-build-a-persistent-store-for-artifact-downloads
 * 
 * Browser implementation using localforage for persistent storage
 */

import { ArtifactStore } from '@railgun-community/wallet';
import localforage from 'localforage';

/**
 * Create artifact store for browser environment
 * Stores RAILGUN artifacts (proofs, circuits) in browser persistent storage
 * @returns {ArtifactStore} Configured artifact store
 */
export const createArtifactStore = () => {
  // Configure localforage for RAILGUN artifacts
  const railgunStorage = localforage.createInstance({
    name: 'RailgunArtifacts',
    storeName: 'artifacts',
    description: 'RAILGUN cryptographic artifacts and proofs storage'
  });

  const getFile = async (path) => {
    try {
      const item = await railgunStorage.getItem(path);
      if (!item) {
        throw new Error(`Artifact not found: ${path}`);
      }
      return item;
    } catch (error) {
      console.error('[ArtifactStore] Failed to get file:', path, error);
      throw error;
    }
  };

  const storeFile = async (dir, path, item) => {
    try {
      const fullPath = `${dir}/${path}`;
      await railgunStorage.setItem(fullPath, item);
      console.log('[ArtifactStore] Stored artifact:', fullPath);
    } catch (error) {
      console.error('[ArtifactStore] Failed to store file:', path, error);
      throw error;
    }
  };

  const fileExists = async (path) => {
    try {
      const item = await railgunStorage.getItem(path);
      return item !== null;
    } catch (error) {
      console.error('[ArtifactStore] Failed to check file existence:', path, error);
      return false;
    }
  };

  return new ArtifactStore(getFile, storeFile, fileExists);
};

export default createArtifactStore; 