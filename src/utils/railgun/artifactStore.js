/**
 * RAILGUN Artifact Store Implementation
 * Creates a persistent storage mechanism for RAILGUN artifacts using localforage
 * Based on: https://docs.railgun.org/developer-guide/wallet/getting-started/2.-build-a-persistent-store-for-artifact-downloads
 */

import { ArtifactStore } from '@railgun-community/wallet';
import localforage from 'localforage';

export const createArtifactStore = async () => {
  // Configure localforage for RAILGUN artifacts
  // Use IndexedDB as preferred storage for large files (artifacts can be 50MB+)
  const railgunStorage = localforage.createInstance({
    name: 'RailgunArtifacts',
    storeName: 'artifacts',
    description: 'RAILGUN cryptographic artifacts and proofs storage',
    driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
    version: 1.0,
    size: 4980736 // ~5MB size hint for WebSQL fallback
  });

  console.log('[ArtifactStore] Creating RAILGUN artifact store...');
  console.log('[ArtifactStore] Configured storage driver:', railgunStorage.driver());
  
  // Test localForage is working
  try {
    await railgunStorage.setItem('test', 'localforage-works');
    const testValue = await railgunStorage.getItem('test');
    console.log('[ArtifactStore] LocalForage test:', testValue === 'localforage-works' ? 'PASS' : 'FAIL');
    await railgunStorage.removeItem('test');
  } catch (error) {
    console.error('[ArtifactStore] LocalForage test FAILED:', error);
    throw new Error('LocalForage initialization failed');
  }
  
  console.log('[ArtifactStore] ArtifactStore import type:', typeof ArtifactStore);
  console.log('[ArtifactStore] ArtifactStore constructor:', ArtifactStore);

  const artifactStore = new ArtifactStore(
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

  console.log('[ArtifactStore] Instance created');
  console.log('[ArtifactStore] Instance type:', typeof artifactStore);
  console.log('[ArtifactStore] Instance prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(artifactStore)));
  console.log('[ArtifactStore] Instance own properties:', Object.getOwnPropertyNames(artifactStore));
  console.log('[ArtifactStore] Has get method:', typeof artifactStore.get === 'function');
  console.log('[ArtifactStore] Has set method:', typeof artifactStore.set === 'function');
  console.log('[ArtifactStore] Has exists method:', typeof artifactStore.exists === 'function');

  return artifactStore;
}; 