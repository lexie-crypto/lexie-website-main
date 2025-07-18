/**
 * RAILGUN Artifact Store Implementation
 * Creates a persistent storage mechanism for RAILGUN artifacts using localforage
 * Based on: https://docs.railgun.org/developer-guide/wallet/getting-started/2.-build-a-persistent-store-for-artifact-downloads
 */

import { ArtifactStore } from '@railgun-community/wallet';
import localforage from 'localforage';

export const createArtifactStore = () => {
  // Configure localforage for RAILGUN artifacts
  const railgunStorage = localforage.createInstance({
    name: 'RailgunArtifacts',
    storeName: 'artifacts',
    description: 'RAILGUN cryptographic artifacts and proofs storage'
  });

  console.log('[ArtifactStore] Creating RAILGUN artifact store...');

  return new ArtifactStore(
    async (path) => {
      console.log('[ArtifactStore] Getting file:', path);
      return railgunStorage.getItem(path);
    },
    async (dir, path, item) => {
      console.log('[ArtifactStore] Storing file:', path, 'Size:', item?.length || 'unknown');
      await railgunStorage.setItem(path, item);
    },
    async (path) => (await railgunStorage.getItem(path)) != null,
  );
}; 