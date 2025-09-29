/**
 * IDB Sync Events
 * Listens to app events and triggers sync operations
 */

import { setDirtyFlag, hasDirtyFlags } from './state.js';

// Debounce settings
const DEBOUNCE_MS = 2000; // 2 seconds
const MAX_FREQUENCY_MS = 60000; // Max once per minute

let syncTimeout = null;
let lastSyncTime = 0;

/**
 * Debounced sync scheduler
 */
const scheduleDebouncedSync = () => {
  const now = Date.now();

  // Check if we're within max frequency limit
  if (now - lastSyncTime < MAX_FREQUENCY_MS) {
    console.debug('[IDB-Sync-Events] Skipping sync - too frequent');
    return;
  }

  // Clear existing timeout
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }

  // Schedule new sync
  syncTimeout = setTimeout(async () => {
    if (hasDirtyFlags()) {
      lastSyncTime = Date.now();
      try {
        // Use global scheduler reference to avoid circular imports
        if (window.__LEXIE_IDB_SYNC_SCHEDULER__) {
          await window.__LEXIE_IDB_SYNC_SCHEDULER__();
        } else {
          console.warn('[IDB-Sync-Events] Scheduler not available yet');
        }
      } catch (error) {
        console.error('[IDB-Sync-Events] Sync failed:', error);
      }
    }
  }, DEBOUNCE_MS);
};

/**
 * Set up event listeners for sync triggers
 */
export const setupEventListeners = () => {
  if (typeof window === 'undefined') return;

  console.log('[IDB-Sync-Events] Setting up event listeners');

  // Balance refresh events
  window.addEventListener('railgun-balance-update', () => {
    console.debug('[IDB-Sync-Events] Balance update detected');
    setDirtyFlag('merkletree');
    setDirtyFlag('wallets');
    scheduleDebouncedSync();
  });

  // Scan progress events (multiple sources)
  window.addEventListener('railgun-init-progress', () => {
    console.debug('[IDB-Sync-Events] Init progress detected');
    setDirtyFlag('merkletree');
    scheduleDebouncedSync();
  });

  // UTXO Merkletree scan progress (real-time during scanning)
  window.addEventListener('railgun-utxo-scan', () => {
    console.debug('[IDB-Sync-Events] UTXO scan progress detected');
    setDirtyFlag('merkletree');
    setDirtyFlag('commitments');
    scheduleDebouncedSync();
  });

  // TXID Merkletree scan progress (real-time during scanning)
  window.addEventListener('railgun-txid-scan', () => {
    console.debug('[IDB-Sync-Events] TXID scan progress detected');
    setDirtyFlag('merkletree');
    setDirtyFlag('nullifiers');
    scheduleDebouncedSync();
  });

  // Wallet ready events
  window.addEventListener('railgun-wallet-metadata-ready', () => {
    console.debug('[IDB-Sync-Events] Wallet metadata ready');
    setDirtyFlag('wallets');
    scheduleDebouncedSync();
  });

  // Transaction events
  window.addEventListener('railgun-transaction-confirmed', () => {
    console.debug('[IDB-Sync-Events] Transaction confirmed');
    setDirtyFlag('commitments');
    setDirtyFlag('nullifiers');
    setDirtyFlag('notes');
    scheduleDebouncedSync();
  });

  // Note changes
  window.addEventListener('railgun-notes-updated', () => {
    console.debug('[IDB-Sync-Events] Notes updated');
    setDirtyFlag('notes');
    scheduleDebouncedSync();
  });

  // Manual sync trigger (for debugging)
  window.addEventListener('lexie-idb-sync-trigger', () => {
    console.log('[IDB-Sync-Events] Manual sync trigger');
    // Set all stores as dirty for full sync
    ['artifacts', 'merkletree', 'wallets', 'commitments', 'nullifiers', 'notes'].forEach(store => {
      setDirtyFlag(store);
    });
    scheduleDebouncedSync();
  });

  console.log('[IDB-Sync-Events] Event listeners setup complete');
};

/**
 * Clean up event listeners
 */
export const cleanupEventListeners = () => {
  if (typeof window === 'undefined') return;

  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }

  console.log('[IDB-Sync-Events] Event listeners cleaned up');
};

/**
 * Initialize IDB sync system
 */
export const initializeIDBSync = () => {
  setupEventListeners();

  // Set up periodic queue processing (every 30 seconds)
  const queueInterval = setInterval(async () => {
    try {
      const { processQueue } = await import('./queue.js');
      await processQueue();
    } catch (error) {
      console.error('[IDB-Sync-Events] Queue processing failed:', error);
    }
  }, 30000);

  // Clean up on page unload
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      cleanupEventListeners();
      clearInterval(queueInterval);
    });
  }

  console.log('[IDB-Sync-Events] IDB sync system initialized');
};
