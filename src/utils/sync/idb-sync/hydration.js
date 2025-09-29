/**
 * IDB Hydration - Redis → IndexedDB Sync
 * Downloads latest Redis snapshot and recreates LevelJS DB in browser
 */

import { getLatestManifest, getSyncChunk } from './api.js';

/**
 * Hydration state management
 */
class HydrationManager {
  constructor() {
    this.activeHydrations = new Map(); // walletId -> hydration state
    this.abortControllers = new Map(); // walletId -> AbortController
  }

  /**
   * Get hydration state for a wallet
   */
  getHydrationState(walletId) {
    return this.activeHydrations.get(walletId) || {
      status: 'idle',
      progress: 0,
      lastChunk: -1,
      totalChunks: 0,
      errors: []
    };
  }

  /**
   * Update hydration state for a wallet
   */
  updateHydrationState(walletId, updates) {
    const current = this.getHydrationState(walletId);
    const newState = { ...current, ...updates };
    this.activeHydrations.set(walletId, newState);

    // Persist progress to localStorage
    try {
      const key = `lexie_hydration_${walletId}`;
      localStorage.setItem(key, JSON.stringify({
        lastChunk: newState.lastChunk,
        latestTs: newState.latestTs,
        status: newState.status
      }));
    } catch (error) {
      console.warn('[IDB-Hydration] Failed to persist hydration state:', error);
    }

    return newState;
  }

  /**
   * Load persisted hydration state from localStorage
   */
  loadPersistedState(walletId) {
    try {
      const key = `lexie_hydration_${walletId}`;
      const persisted = localStorage.getItem(key);
      if (persisted) {
        return JSON.parse(persisted);
      }
    } catch (error) {
      console.warn('[IDB-Hydration] Failed to load persisted state:', error);
    }
    return null;
  }

  /**
   * Start hydration for a wallet
   */
  async startHydration(walletId, options = {}) {
    const {
      force = false,
      onProgress = null,
      onComplete = null,
      onError = null
    } = options;

    // Check if hydration is already running
    const currentState = this.getHydrationState(walletId);
    if (currentState.status === 'running') {
      console.log('[IDB-Hydration] Hydration already running for wallet:', walletId);
      return currentState;
    }

    // Create abort controller
    const abortController = new AbortController();
    this.abortControllers.set(walletId, abortController);

    // Start hydration in background
    this.runHydration(walletId, {
      force,
      abortController,
      onProgress,
      onComplete,
      onError
    }).catch(error => {
      console.error('[IDB-Hydration] Hydration failed:', error);
      if (onError) onError(error);
    });

    return this.getHydrationState(walletId);
  }

  /**
   * Run the hydration process
   */
  async runHydration(walletId, { force, abortController, onProgress, onComplete, onError }) {
    try {
      console.log('[IDB-Hydration] Starting hydration for wallet:', walletId);

      // Load persisted state
      const persistedState = this.loadPersistedState(walletId);
      let resumeFromChunk = -1;

      if (persistedState && !force) {
        resumeFromChunk = persistedState.lastChunk;
        console.log('[IDB-Hydration] Resuming from chunk:', resumeFromChunk);
      }

      // Update state to running
      this.updateHydrationState(walletId, {
        status: 'running',
        progress: 0,
        lastChunk: resumeFromChunk,
        errors: []
      });

      // Get latest manifest
      console.log('[IDB-Hydration] Fetching latest manifest...');
      const manifest = await this.fetchManifest(walletId, abortController.signal);

      if (abortController.signal.aborted) {
        throw new Error('Hydration aborted');
      }

      // Check if we need to hydrate
      if (!force && persistedState && persistedState.latestTs === manifest.ts) {
        console.log('[IDB-Hydration] Wallet already up to date');
        this.updateHydrationState(walletId, {
          status: 'completed',
          progress: 100
        });
        if (onComplete) onComplete();
        return;
      }

      // Start chunk processing
      await this.processChunks(walletId, manifest, resumeFromChunk, abortController.signal, onProgress);

      // Mark as completed
      this.updateHydrationState(walletId, {
        status: 'completed',
        progress: 100,
        latestTs: manifest.ts
      });

      console.log('[IDB-Hydration] Hydration completed for wallet:', walletId);
      if (onComplete) onComplete();

    } catch (error) {
      console.error('[IDB-Hydration] Hydration error:', error);

      const errorState = {
        status: 'error',
        error: error.message,
        errors: [...(this.getHydrationState(walletId).errors || []), error.message]
      };

      this.updateHydrationState(walletId, errorState);
      if (onError) onError(error);
    } finally {
      // Clean up abort controller
      this.abortControllers.delete(walletId);
    }
  }

  /**
   * Fetch latest manifest
   */
  async fetchManifest(walletId, abortSignal) {
    try {
      const response = await getLatestManifest(walletId);

      if (!response || typeof response.ts !== 'number') {
        throw new Error('Invalid manifest response');
      }

      return {
        ts: response.ts,
        recordCount: response.recordCount || 0,
        totalBytes: response.totalBytes || 0,
        chunkCount: response.chunkCount || 0,
        chunkHashes: response.chunkHashes || []
      };
    } catch (error) {
      if (error.message.includes('404') || error.message.includes('No sync data found')) {
        throw new Error('No sync data available for this wallet');
      }
      throw error;
    }
  }

  /**
   * Process chunks sequentially
   */
  async processChunks(walletId, manifest, resumeFromChunk, abortSignal, onProgress) {
    const { chunkCount, chunkHashes } = manifest;
    let processedChunks = resumeFromChunk + 1;

    console.log(`[IDB-Hydration] Processing ${chunkCount} chunks, starting from ${processedChunks}`);

    // Process chunks sequentially to avoid overwhelming IDB
    for (let i = processedChunks; i < chunkCount; i++) {
      if (abortSignal.aborted) {
        throw new Error('Hydration aborted');
      }

      try {
        console.log(`[IDB-Hydration] Processing chunk ${i}/${chunkCount}`);

        // Fetch chunk
        const chunkData = await this.fetchChunk(walletId, manifest.ts, i, abortSignal);

        // Verify chunk hash if available
        if (chunkHashes[i]) {
          const calculatedHash = await this.calculateHash(chunkData);
          if (calculatedHash !== chunkHashes[i]) {
            throw new Error(`Chunk ${i} hash verification failed`);
          }
        }

        // Write to IDB
        await this.writeChunkToIDB(chunkData, abortSignal);

        // Update progress
        processedChunks = i + 1;
        const progress = Math.round((processedChunks / chunkCount) * 100);

        this.updateHydrationState(walletId, {
          lastChunk: i,
          progress,
          status: 'running'
        });

        if (onProgress) {
          onProgress(progress, i, chunkCount);
        }

        // Small delay to prevent overwhelming the browser
        await new Promise(resolve => setTimeout(resolve, 10));

      } catch (error) {
        console.error(`[IDB-Hydration] Error processing chunk ${i}:`, error);

        // For network errors, we could implement retry logic here
        // For now, rethrow to fail the entire hydration
        throw error;
      }
    }
  }

  /**
   * Fetch a chunk
   */
  async fetchChunk(walletId, timestamp, chunkIndex, abortSignal) {
    const response = await getSyncChunk(walletId, timestamp, chunkIndex);

    if (typeof response !== 'string') {
      throw new Error('Invalid chunk response - expected NDJSON string');
    }

    return response;
  }

  /**
   * Calculate SHA-256 hash of data
   */
  async calculateHash(data) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Write chunk data to IndexedDB
   */
  async writeChunkToIDB(ndjsonData, abortSignal) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('level-js-railgun-engine-db', 1);

      request.onerror = () => reject(new Error('Failed to open IDB'));
      request.onsuccess = (event) => {
        const db = event.target.result;

        try {
          // Process NDJSON lines
          const lines = ndjsonData.trim().split('\n');
          const records = [];

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const record = JSON.parse(line);
              if (record.k_b64 && record.v_b64) {
                // Decode base64 keys and values to ArrayBuffers
                const key = Uint8Array.from(atob(record.k_b64), c => c.charCodeAt(0)).buffer;
                const value = Uint8Array.from(atob(record.v_b64), c => c.charCodeAt(0)).buffer;
                records.push({ key, value });
              }
            } catch (parseError) {
              console.warn('[IDB-Hydration] Failed to parse NDJSON line:', parseError);
            }
          }

          // Write records in a transaction
          const transaction = db.transaction(['railgun-engine-db'], 'readwrite');
          const store = transaction.objectStore('railgun-engine-db');

          let completed = 0;
          const total = records.length;

          if (total === 0) {
            resolve();
            return;
          }

          const checkComplete = () => {
            completed++;
            if (completed >= total) {
              transaction.commit();
              resolve();
            }
          };

          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(new Error('IDB transaction failed'));
          transaction.onabort = () => reject(new Error('IDB transaction aborted'));

          // Write all records
          for (const record of records) {
            const putRequest = store.put(record.value, record.key);
            putRequest.onsuccess = checkComplete;
            putRequest.onerror = () => {
              console.warn('[IDB-Hydration] Failed to write record');
              checkComplete(); // Continue anyway
            };
          }

        } catch (error) {
          reject(error);
        } finally {
          db.close();
        }
      };
    });
  }

  /**
   * Cancel hydration for a wallet
   */
  cancelHydration(walletId) {
    const abortController = this.abortControllers.get(walletId);
    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(walletId);
    }

    this.updateHydrationState(walletId, {
      status: 'cancelled'
    });
  }

  /**
   * Reset hydration state for a wallet
   */
  resetHydration(walletId) {
    this.activeHydrations.delete(walletId);
    this.abortControllers.delete(walletId);

    try {
      localStorage.removeItem(`lexie_hydration_${walletId}`);
    } catch (error) {
      console.warn('[IDB-Hydration] Failed to clear persisted state:', error);
    }
  }
}

// Singleton instance
const hydrationManager = new HydrationManager();

/**
 * Public API
 */

/**
 * Start hydration for a wallet
 */
export const startHydration = async (walletId, options = {}) => {
  return await hydrationManager.startHydration(walletId, options);
};

/**
 * Get hydration status for a wallet
 */
export const getHydrationStatus = (walletId) => {
  return hydrationManager.getHydrationState(walletId);
};

/**
 * Cancel hydration for a wallet
 */
export const cancelHydration = (walletId) => {
  return hydrationManager.cancelHydration(walletId);
};

/**
 * Reset hydration state for a wallet
 */
export const resetHydration = (walletId) => {
  return hydrationManager.resetHydration(walletId);
};

/**
 * Check if hydration is needed for a wallet
 * Returns true if wallet has no local data or local timestamp differs from server
 */
export const checkHydrationNeeded = async (walletId) => {
  try {
    const persistedState = hydrationManager.loadPersistedState(walletId);
    const manifest = await hydrationManager.fetchManifest(walletId);

    if (!persistedState) {
      return true; // No local state, need hydration
    }

    return persistedState.latestTs !== manifest.ts;
  } catch (error) {
    console.warn('[IDB-Hydration] Error checking hydration needed:', error);
    return true; // Assume hydration needed on error
  }
};
