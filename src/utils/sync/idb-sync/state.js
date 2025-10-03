/**
 * IDB Sync State Management
 * Manages dirty flags, sync cursors, and hashes for IndexedDB → Redis sync
 */

// Using console for logging (eliza not available in frontend)

// Storage keys
const STORAGE_PREFIX = 'lexie:idb-sync:';
const DIRTY_FLAGS_KEY = STORAGE_PREFIX + 'dirty-flags';
const SYNC_CURSORS_KEY = STORAGE_PREFIX + 'cursors';
const SYNC_HASHES_KEY = STORAGE_PREFIX + 'hashes';
const SNAPSHOT_CURSORS_KEY = STORAGE_PREFIX + 'snapshot-cursors';

/**
 * IDB stores to sync (matching Railgun's IndexedDB structure)
 */
export const SYNC_STORES = [
  'artifacts',      // Railgun artifacts (zkeys, wasm, etc.)
  'merkletree',     // Merkle tree data
  'wallets',        // Wallet metadata
  'commitments',    // Commitment data
  'nullifiers',     // Nullifier data
  'notes'           // Private notes
];

/**
 * Get dirty flags for all stores
 */
export const getDirtyFlags = () => {
  try {
    const stored = localStorage.getItem(DIRTY_FLAGS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to load dirty flags:', error);
    return {};
  }
};

/**
 * Set dirty flag for a specific store
 */
export const setDirtyFlag = (storeName, isDirty = true) => {
  try {
    const flags = getDirtyFlags();
    flags[storeName] = isDirty;
    localStorage.setItem(DIRTY_FLAGS_KEY, JSON.stringify(flags));
    console.debug(`[IDB-Sync-State] Set dirty flag for ${storeName}: ${isDirty}`);
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to set dirty flag:', error);
  }
};

/**
 * Clear dirty flag for a specific store
 */
export const clearDirtyFlag = (storeName) => {
  setDirtyFlag(storeName, false);
};

/**
 * Check if any store has dirty flags
 */
export const hasDirtyFlags = () => {
  const flags = getDirtyFlags();
  return Object.values(flags).some(Boolean);
};

/**
 * Get sync cursors for all stores
 */
export const getSyncCursors = () => {
  try {
    const stored = localStorage.getItem(SYNC_CURSORS_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to load sync cursors:', error);
    return {};
  }
};

/**
 * Set sync cursor for a specific store
 */
export const setSyncCursor = (storeName, cursor) => {
  try {
    const cursors = getSyncCursors();
    cursors[storeName] = cursor;
    localStorage.setItem(SYNC_CURSORS_KEY, JSON.stringify(cursors));
    console.debug(`[IDB-Sync-State] Set cursor for ${storeName}: ${cursor}`);
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to set sync cursor:', error);
  }
};

/**
 * Get sync cursor for a specific store
 */
export const getSyncCursor = (storeName) => {
  const cursors = getSyncCursors();
  return cursors[storeName] || null;
};

/**
 * Get sync hashes for verification
 */
export const getSyncHashes = () => {
  try {
    const stored = localStorage.getItem(SYNC_HASHES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to load sync hashes:', error);
    return {};
  }
};

/**
 * Set sync hash for a specific store
 */
export const setSyncHash = (storeName, hash) => {
  try {
    const hashes = getSyncHashes();
    hashes[storeName] = hash;
    localStorage.setItem(SYNC_HASHES_KEY, JSON.stringify(hashes));
    console.debug(`[IDB-Sync-State] Set hash for ${storeName}: ${hash}`);
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to set sync hash:', error);
  }
};

/**
 * Get sync hash for a specific store
 */
export const getSyncHash = (storeName) => {
  const hashes = getSyncHashes();
  return hashes[storeName] || null;
};

/**
 * Reset all sync state (useful for debugging)
 */
export const resetSyncState = () => {
  try {
    localStorage.removeItem(DIRTY_FLAGS_KEY);
    localStorage.removeItem(SYNC_CURSORS_KEY);
    localStorage.removeItem(SYNC_HASHES_KEY);
    console.log('[IDB-Sync-State] Reset all sync state');
  } catch (error) {
    console.error('[IDB-Sync-State] Failed to reset sync state:', error);
  }
};

/**
 * Get sync status for all stores
 */
export const getSyncStatus = () => {
  return {
    dirtyFlags: getDirtyFlags(),
    cursors: getSyncCursors(),
    hashes: getSyncHashes(),
    hasDirtyFlags: hasDirtyFlags()
  };
};

/**
 * Get snapshot cursor for resumable exports
 */
export const getSnapshotCursor = (walletId) => {
  try {
    const cursors = JSON.parse(localStorage.getItem(SNAPSHOT_CURSORS_KEY) || '{}');
    return cursors[walletId] || null;
  } catch (e) {
    console.warn('[IDB-State] Failed to get snapshot cursor:', e);
    return null;
  }
};

/**
 * Set snapshot cursor for resumable exports
 */
export const setSnapshotCursor = (walletId, cursorB64) => {
  try {
    const cursors = JSON.parse(localStorage.getItem(SNAPSHOT_CURSORS_KEY) || '{}');
    cursors[walletId] = cursorB64;
    localStorage.setItem(SNAPSHOT_CURSORS_KEY, JSON.stringify(cursors));
  } catch (e) {
    console.warn('[IDB-State] Failed to set snapshot cursor:', e);
  }
};

/**
 * Clear snapshot cursor (for fresh exports or after completion)
 */
export const clearSnapshotCursor = (walletId) => {
  try {
    const cursors = JSON.parse(localStorage.getItem(SNAPSHOT_CURSORS_KEY) || '{}');
    delete cursors[walletId];
    localStorage.setItem(SNAPSHOT_CURSORS_KEY, JSON.stringify(cursors));
  } catch (e) {
    console.warn('[IDB-State] Failed to clear snapshot cursor:', e);
  }
};
