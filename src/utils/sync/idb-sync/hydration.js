/**
 * IDB Hydration - Redis → IndexedDB Sync
 * Downloads latest Redis snapshot and recreates LevelJS DB in browser
 */

import { getLatestManifest, getSyncChunk, getChainLatestTimestamp, getChainManifest, getChainChunk } from './api.js';

/**
 * Decompress data using DecompressionStream (supports gzip and brotli)
 */
async function decompressData(compressedData, format = 'gzip') {
  try {
    // Check if DecompressionStream is available (modern browsers)
    if (typeof DecompressionStream !== 'undefined') {
      let stream;

      // Try the specified format first, fallback to gzip
      try {
        stream = new DecompressionStream(format);
      } catch (formatError) {
        console.warn(`[IDB-Hydration] ${format} decompression not supported, trying gzip`);
        stream = new DecompressionStream('gzip');
      }

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      // Write compressed data
      writer.write(compressedData);
      writer.close();

      // Read decompressed data
      const chunks = [];
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) chunks.push(value);
      }

      // Combine chunks into a single Uint8Array
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to string
      return new TextDecoder().decode(result);
    } else {
      // Fallback: assume data is already decompressed
      console.warn('[IDB-Hydration] DecompressionStream not available, assuming uncompressed data');
      return typeof compressedData === 'string' ? compressedData : new TextDecoder().decode(compressedData);
    }
  } catch (error) {
    console.warn('[IDB-Hydration] Decompression failed:', error);
    // Fallback to treating as uncompressed
    return typeof compressedData === 'string' ? compressedData : new TextDecoder().decode(compressedData);
  }
}

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

    try {
      // Wait for hydration to complete
      await this.runHydration(walletId, {
        force,
        abortController,
        onProgress,
        onComplete,
        onError
      });

      // Return final state
      return this.getHydrationState(walletId);
    } catch (error) {
      console.error('[IDB-Hydration] Hydration failed:', error);
      if (onError) onError(error);
      throw error; // Re-throw so caller knows it failed
    } finally {
      // Clean up abort controller
      this.abortControllers.delete(walletId);
    }
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

      // This function is no longer used - we now use chain-specific loading
      throw new Error('runHydration is deprecated - use loadChainBootstrap instead');

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

      // Try snapshot mode first (much faster), fall back to chunks
      console.log('[IDB-Hydration] Attempting snapshot mode...');
      try {
        await this.processSnapshot(walletId, manifest, abortController.signal, onProgress);
        console.log('[IDB-Hydration] Snapshot hydration completed successfully');
      } catch (snapshotError) {
        console.warn('[IDB-Hydration] Snapshot mode failed, falling back to chunks:', snapshotError.message);

        // Fall back to chunk processing
        await this.processChunks(walletId, manifest, resumeFromChunk, abortController.signal, onProgress);
      }

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
   * Check if chain bootstrap is available
   */
  async checkChainBootstrapAvailable(chainId) {
    try {
      const timestamp = await getChainLatestTimestamp(chainId);
      return timestamp !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fetch chain-specific manifest
   */
  async fetchChainManifest(chainId, abortSignal) {
    try {
      console.log(`[IDB-Hydration] Fetching chain ${chainId} bootstrap manifest`);

      const timestamp = await getChainLatestTimestamp(chainId);
      if (!timestamp) {
        throw new Error(`No bootstrap available for chain ${chainId}`);
      }

      const response = await getChainManifest(chainId, timestamp);
      console.log(`[IDB-Hydration] Chain ${chainId} manifest response:`, response);

      if (!response || typeof response.timestamp !== 'number') {
        throw new Error('Invalid chain manifest response');
      }

      // Verify this is chain-specific bootstrap data
      if (parseInt(response.chainId) !== parseInt(chainId)) {
        throw new Error(`Manifest is not valid chain ${chainId} bootstrap data (wrong chain: ${response.chainId})`);
      }

      // For chain bootstrap, overallHash is optional - focus on chain validation
      if (!response.totalRecords || !response.chunkCount) {
        throw new Error(`Manifest missing required fields for chain ${chainId} bootstrap data`);
      }

      const manifest = {
        ts: response.timestamp,
        recordCount: response.totalRecords || 0,
        totalBytes: response.totalBytes || 0,
        chunkCount: response.chunkCount || 0,
        chunkHashes: response.chunkHashes || [],
        overallHash: response.overallHash || null,
        chainId: response.chainId
      };

      return manifest;

    } catch (error) {
      console.warn(`[IDB-Hydration] Chain ${chainId} bootstrap not available:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch global bootstrap manifest (preferred for new users)
   */
  async fetchGlobalManifest(abortSignal) {
    try {
      console.log('[IDB-Hydration] Fetching global bootstrap manifest');
      // Call without walletId to get global bootstrap data
      const response = await getLatestManifest('');
      console.log('[IDB-Hydration] Global manifest response:', response);

      if (!response || typeof response.ts !== 'number') {
        throw new Error('Invalid global manifest response');
      }

      // Verify this is global bootstrap data
      if (!response.overallHash) {
        throw new Error('Manifest is not global bootstrap data');
      }

      const manifest = {
        ts: response.ts,
        recordCount: response.recordCount || 0,
        totalBytes: response.totalBytes || 0,
        chunkCount: response.chunkCount || 0,
        chunkHashes: response.chunkHashes || [],
        overallHash: response.overallHash, // For snapshot verification
        isGlobalBootstrap: true
      };

      console.log('[IDB-Hydration] Parsed global manifest:', manifest);
      return manifest;
    } catch (error) {
      console.log('[IDB-Hydration] Global manifest fetch error:', error);
      throw error;
    }
  }

  /**
   * Fetch latest manifest
   */
  async fetchManifest(walletId, abortSignal) {
    try {
      console.log('[IDB-Hydration] Fetching manifest for wallet:', walletId);
      const response = await getLatestManifest(walletId);
      console.log('[IDB-Hydration] Manifest response:', response);

      if (!response || typeof response.ts !== 'number') {
        throw new Error('Invalid manifest response');
      }

      const manifest = {
        ts: response.ts,
        recordCount: response.recordCount || 0,
        totalBytes: response.totalBytes || 0,
        chunkCount: response.chunkCount || 0,
        chunkHashes: response.chunkHashes || []
      };

      console.log('[IDB-Hydration] Parsed manifest:', manifest);
      return manifest;
    } catch (error) {
      console.log('[IDB-Hydration] Manifest fetch error:', error);
      if (error.message.includes('404') || error.message.includes('No sync data found')) {
        throw new Error('No sync data available');
      }
      throw error;
    }
  }

  /**
   * Process compressed snapshot (preferred - much faster)
   */
  async processSnapshot(walletId, manifest, abortSignal, onProgress) {
    const { getSyncSnapshot } = await import('./api.js');

    if (abortSignal?.aborted) {
      throw new Error('Snapshot processing aborted');
    }

    console.log('[IDB-Hydration] Fetching compressed snapshot...');

    try {
      // Fetch compressed snapshot
      const snapshotData = await getSyncSnapshot('', manifest.ts);

      if (typeof snapshotData !== 'string') {
        throw new Error('Invalid snapshot response - expected NDJSON string');
      }

      // Verify snapshot hash if available
      if (manifest.overallHash) {
        console.log('[IDB-Hydration] Verifying snapshot integrity...');
        const calculatedHash = await this.calculateHash(snapshotData);
        if (calculatedHash !== manifest.overallHash) {
          throw new Error(`Snapshot hash verification failed: expected ${manifest.overallHash}, got ${calculatedHash}`);
        }
        console.log('[IDB-Hydration] Snapshot integrity verified ✓');
      } else {
        console.warn('[IDB-Hydration] No overallHash available for snapshot verification');
      }

      // Update progress to 50% (download complete)
      if (onProgress) {
        onProgress(50, 0, 1);
      }

      // Write entire snapshot to IDB
      console.log('[IDB-Hydration] Writing snapshot to IDB...');
      await this.writeChunkToIDB(snapshotData, abortSignal);

      // Update progress to 100%
      if (onProgress) {
        onProgress(100, 1, 1);
      }

      console.log('[IDB-Hydration] Snapshot processed successfully');

    } catch (error) {
      console.log('[IDB-Hydration] Snapshot failed, will fall back to chunks:', error.message);
      if (error.message.includes('404') || error.message.includes('not available') || error.message.includes('SNAPSHOT_NOT_AVAILABLE')) {
        throw new Error('SNAPSHOT_NOT_AVAILABLE');
      }
      throw error;
    }
  }

  /**
   * Process chain-specific snapshot (much faster than chunks)
   */
  async processChainSnapshot(walletId, chainId, manifest, abortSignal, onProgress) {
    const { getSyncSnapshot } = await import('./api.js');

    if (abortSignal?.aborted) {
      throw new Error('Chain snapshot processing aborted');
    }

    console.log(`[IDB-Hydration] Fetching chain ${chainId} snapshot...`);

    try {
      // Fetch compressed snapshot with chain parameters
      console.log(`[IDB-Hydration] 🗜️ Requesting brotli compressed snapshot for chain ${chainId}`);
      const snapshotData = await getSyncSnapshot('', manifest.ts, chainId);
      console.log(`[IDB-Hydration] 📦 Received decompressed snapshot: ${snapshotData.length} bytes`);

      if (typeof snapshotData !== 'string') {
        throw new Error('Invalid chain snapshot response - expected NDJSON string');
      }

      // Verify snapshot hash if available
      if (manifest.overallHash) {
        console.log(`[IDB-Hydration] Verifying chain ${chainId} snapshot integrity...`);
        const calculatedHash = await this.calculateHash(snapshotData);
        if (calculatedHash !== manifest.overallHash) {
          throw new Error(`Chain ${chainId} snapshot hash verification failed: expected ${manifest.overallHash}, got ${calculatedHash}`);
        }
        console.log(`[IDB-Hydration] Chain ${chainId} snapshot integrity verified ✓`);
      } else {
        console.warn(`[IDB-Hydration] No overallHash available for chain ${chainId} snapshot verification`);
      }

      // Update progress to 50% (download complete)
      if (onProgress) {
        onProgress(50, 0, 1);
      }

      // Write entire snapshot to IDB (append mode for multi-chain)
      console.log(`[IDB-Hydration] Writing chain ${chainId} snapshot to IDB...`);
      await this.writeChainSnapshotToIDB(snapshotData, abortSignal);

      // Update progress to 100%
      if (onProgress) {
        onProgress(100, 1, 1);
      }

      console.log(`[IDB-Hydration] Chain ${chainId} snapshot processed successfully`);

    } catch (error) {
      console.log(`[IDB-Hydration] Chain ${chainId} snapshot failed, will fall back to chunks:`, error.message);
      if (error.message.includes('404') || error.message.includes('not available') || error.message.includes('SNAPSHOT_NOT_AVAILABLE')) {
        throw new Error('CHAIN_SNAPSHOT_NOT_AVAILABLE');
      }
      throw error;
    }
  }

  /**
   * Process chunks with parallel downloading but sequential IDB writes
   */
  async processChunks(walletId, manifest, resumeFromChunk, abortSignal, onProgress) {
    const { chunkCount, chunkHashes } = manifest;
    let processedChunks = resumeFromChunk + 1;

    console.log(`[IDB-Hydration] Processing ${chunkCount} chunks, starting from ${processedChunks}`);

    const CONCURRENT_DOWNLOADS = 6; // Download 2 chunks in parallel to reduce server load

    // Process chunks in batches for parallel downloading
    for (let batchStart = processedChunks; batchStart < chunkCount; batchStart += CONCURRENT_DOWNLOADS) {
      if (abortSignal.aborted) {
        throw new Error('Hydration aborted');
      }

      const batchEnd = Math.min(batchStart + CONCURRENT_DOWNLOADS, chunkCount);
      const batchPromises = [];

      // Start parallel downloads for this batch
      for (let i = batchStart; i < batchEnd; i++) {
        const downloadPromise = this.fetchChunk(manifest.ts, i, abortSignal)
          .then(chunkData => ({ index: i, data: chunkData }))
          .catch(error => ({ index: i, error }));

        batchPromises.push(downloadPromise);
      }

      // Wait for all downloads in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process results sequentially (maintain IDB write order)
      for (const result of batchResults) {
        const { index, data, error } = result;

        if (error) {
          console.error(`[IDB-Hydration] Error downloading chunk ${index}:`, error);
          throw error;
        }

        try {
          console.log(`[IDB-Hydration] Processing chunk ${index}/${chunkCount}`);

          // Verify chunk hash if available (now that server provides them)
          if (chunkHashes && chunkHashes[index]) {
            console.log(`[IDB-Hydration] Verifying chunk ${index} integrity...`);
            const calculatedHash = await this.calculateHash(data);
            if (calculatedHash !== chunkHashes[index]) {
              throw new Error(`Chunk ${index} hash verification failed: expected ${chunkHashes[index]}, got ${calculatedHash}`);
            }
            console.log(`[IDB-Hydration] Chunk ${index} integrity verified ✓`);
          }

          // Write to IDB (sequential to avoid overwhelming)
          await this.writeChunkToIDB(data, abortSignal);

          // Update progress
          processedChunks = index + 1;
          const progress = Math.round((processedChunks / chunkCount) * 100);

          this.updateHydrationState(walletId, {
            lastChunk: index,
            progress,
            status: 'running'
          });

          if (onProgress) {
            onProgress(progress, index, chunkCount);
          }

        } catch (error) {
          console.error(`[IDB-Hydration] Error processing chunk ${index}:`, error);
          throw error;
        }
      }

      // Small delay between batches to prevent overwhelming the network
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Fetch a chunk
   */
  async fetchChunk(timestamp, chunkIndex, abortSignal) {
    // Use null/empty string for walletId since we're using global chunks
    const response = await getSyncChunk('', timestamp, chunkIndex);

    if (typeof response !== 'string') {
      throw new Error('Invalid chunk response - expected NDJSON string');
    }

    return response;
  }

  /**
   * Fetch chain-specific chunk
   */
  async fetchChainChunk(chainId, timestamp, chunkIndex, abortSignal) {
    console.log(`[IDB-Hydration] 📦 Requesting chunk ${chunkIndex} for chain ${chainId}`);
    const response = await getSyncChunk('', timestamp, chunkIndex, chainId);

    // Handle new response format with data and headers
    const responseData = response.data || response;
    const responseHeaders = response.headers;

    if (typeof responseData !== 'string') {
      throw new Error('Invalid chain chunk response - expected string data');
    }

    // Check if response is compressed (base64 encoded binary data)
    let chunkData = responseData;

    // Try to detect if this is compressed data (binary data will cause JSON.parse to fail)
    try {
      JSON.parse(responseData);
      // If we can parse it as JSON, it's likely uncompressed NDJSON
      console.log(`[IDB-Hydration] 📦 Received uncompressed chunk ${chunkIndex}: ${responseData.length} bytes`);
    } catch (jsonError) {
      // If JSON.parse fails, it's likely compressed binary data encoded as base64
      try {
        // Decode base64 and decompress using the format from response headers
        const compressedBytes = Uint8Array.from(atob(responseData), c => c.charCodeAt(0));

        // Check for compression format in response headers (if available)
        let compressionFormat = 'brotli'; // Default to brotli (preferred)
        if (responseHeaders && responseHeaders.get) {
          const formatHeader = responseHeaders.get('X-Compression-Format');
          if (formatHeader) {
            compressionFormat = formatHeader;
          }
        }

        // Decompress using the specified format with fallback
        try {
          chunkData = await decompressData(compressedBytes, compressionFormat);
          console.log(`[IDB-Hydration] 📦 ${compressionFormat} decompressed chunk ${chunkIndex}: ${compressedBytes.length} → ${chunkData.length} bytes`);
        } catch (formatError) {
          console.warn(`[IDB-Hydration] ${compressionFormat} decompression failed, trying alternatives`);
          // Try the other format
          const altFormat = compressionFormat === 'brotli' ? 'gzip' : 'brotli';
          try {
            chunkData = await decompressData(compressedBytes, altFormat);
            console.log(`[IDB-Hydration] 📦 ${altFormat} decompressed chunk ${chunkIndex}: ${compressedBytes.length} → ${chunkData.length} bytes`);
          } catch (altError) {
            console.warn(`[IDB-Hydration] All decompression attempts failed, assuming uncompressed:`, altError);
            // Fall back to original response
            chunkData = response;
          }
        }
      } catch (decompressError) {
        console.warn(`[IDB-Hydration] Failed to decompress chunk ${chunkIndex}, assuming uncompressed:`, decompressError);
        // Fall back to original response
        chunkData = response;
      }
    }

    return chunkData;
  }

  /**
   * Process chain chunks with parallel downloading but sequential IDB writes
   */
  async processChainChunks(walletId, chainId, manifest, abortSignal, onProgress) {
    const { chunkCount, chunkHashes } = manifest;
    let processedChunks = 0; // Start from beginning for chains

    console.log(`[IDB-Hydration] Processing ${chunkCount} chunks for chain ${chainId}, starting from ${processedChunks}`);

    const CONCURRENT_DOWNLOADS = 10; // Download 2 chunks in parallel to reduce server load

    // Process chunks in batches for parallel downloading
    for (let batchStart = processedChunks; batchStart < chunkCount; batchStart += CONCURRENT_DOWNLOADS) {
      if (abortSignal.aborted) {
        throw new Error('Chain hydration aborted');
      }

      const batchEnd = Math.min(batchStart + CONCURRENT_DOWNLOADS, chunkCount);
      const batchPromises = [];

      // Start parallel downloads for this batch
      for (let i = batchStart; i < batchEnd; i++) {
        const downloadPromise = this.fetchChainChunk(chainId, manifest.ts, i, abortSignal)
          .then(chunkData => ({ index: i, data: chunkData }))
          .catch(error => ({ index: i, error }));

        batchPromises.push(downloadPromise);
      }

      // Wait for all downloads in this batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Process results sequentially (maintain IDB write order)
      for (const result of batchResults) {
        const { index, data, error } = result;

        if (error) {
          console.error(`[IDB-Hydration] Error downloading chain ${chainId} chunk ${index}:`, error);
          throw error;
        }

        try {
          console.log(`[IDB-Hydration] Processing chain ${chainId} chunk ${index}/${chunkCount}`);
          await this.writeChunkToIDB(data, abortSignal);

          // Update progress
          processedChunks++;
          if (onProgress) {
            const progress = (processedChunks / chunkCount) * 100;
            onProgress(progress, processedChunks, chunkCount);
          }
        } catch (writeError) {
          console.error(`[IDB-Hydration] Error writing chain ${chainId} chunk ${index}:`, writeError);
          throw writeError;
        }
      }
    }

    console.log(`[IDB-Hydration] Chain ${chainId} chunk processing completed: ${processedChunks}/${chunkCount} chunks`);
  }

  /**
   * Write chain snapshot to IDB (append mode - skip existing keys)
   */
  async writeChainSnapshotToIDB(ndjsonData, abortSignal) {
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
              console.warn('[IDB-Hydration] Failed to parse NDJSON line in chain snapshot:', parseError);
            }
          }

          // Write records in append mode (skip existing keys)
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

          // Write records (append mode - check if exists first)
          for (const record of records) {
            // Check if key already exists
            const getRequest = store.get(record.key);

            getRequest.onsuccess = () => {
              if (getRequest.result === undefined) {
                // Key doesn't exist - safe to add
                const putRequest = store.put(record.value, record.key);
                putRequest.onsuccess = checkComplete;
                putRequest.onerror = () => {
                  console.warn('[IDB-Hydration] Failed to write chain record');
                  checkComplete(); // Continue anyway
                };
              } else {
                // Key exists - skip to avoid overwriting
                console.log(`[IDB-Hydration] Skipping existing chain key (append mode)`);
                checkComplete();
              }
            };

            getRequest.onerror = () => {
              // If get fails, assume key doesn't exist and try to put
              const putRequest = store.put(record.value, record.key);
              putRequest.onsuccess = checkComplete;
              putRequest.onerror = () => {
                console.warn('[IDB-Hydration] Failed to write chain record after get error');
                checkComplete();
              };
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

// Per-wallet:chain session lock to prevent duplicate hydration
const hydratingChains = new Set();

/**
 * Check if a wallet:chain combination is currently being hydrated
 */
export const isChainHydrating = (walletId, chainId) => {
  const key = `${walletId}:${Number(chainId)}`;
  return hydratingChains.has(key);
};

/**
 * Get hydration guard status for logging
 */
export const getHydrationGuardStatus = (walletId, chainId, hydratedChains) => {
  const isHydrated = Array.isArray(hydratedChains) && hydratedChains.includes(Number(chainId));
  const isLocked = isChainHydrating(walletId, chainId);
  return { isHydrated, isLocked };
};

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

/**
 * Write backup data to IndexedDB (for wallet recovery)
 * @param {string} ndjsonData - NDJSON formatted backup data
 * @returns {Promise<void>}
 */
export const writeBackupToIDB = async (ndjsonData) => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('level-js-railgun-engine-db', 1);

    request.onerror = () => reject(new Error('Failed to open IDB for backup restoration'));
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
            console.warn('[IDB-Hydration] Failed to parse NDJSON line in backup:', parseError);
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
            console.warn('[IDB-Hydration] Failed to write backup record');
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
};

/**
 * Check if chain-specific bootstrap is available
 */
export const checkChainBootstrapAvailable = async (chainId) => {
  return await hydrationManager.checkChainBootstrapAvailable(chainId);
};

/**
 * Load chain-specific bootstrap data
 */
export const loadChainBootstrap = async (walletId, chainId, options = {}) => {
  const {
    force = false,
    onProgress = null,
    onComplete = null,
    onError = null,
    address = null // EOA address for Redis scannedChains check
  } = options;

  const abortController = new AbortController();

  try {
    console.log(`[IDB-Hydration] Starting chain ${chainId} bootstrap for wallet ${walletId}`);

    // First check if chain has already been hydrated in Redis
    if (!force && address) {
      try {
        console.log(`[IDB-Hydration] Checking if chain ${chainId} already hydrated in Redis for address ${address}...`);
        const { checkChainHydratedInRedis } = await import('./hydrationCheckUtils.js');
        const { isHydrated } = await checkChainHydratedInRedis(address, walletId, chainId);

        if (isHydrated) {
          console.log(`[IDB-Hydration] Chain ${chainId} already hydrated in Redis for wallet ${walletId}, skipping hydration`);
          if (onComplete) onComplete();
          return;
        }
      } catch (redisError) {
        console.warn(`[IDB-Hydration] Failed to check Redis hydration status:`, redisError.message);
        // Continue with hydration if Redis check fails
      }
    }

    // Per-wallet:chain session lock: bail if already hydrating this wallet:chain
    if (isChainHydrating(walletId, chainId)) {
      console.log(`[IDB-Hydration] Wallet ${walletId} chain ${chainId} already being hydrated, skipping`);
      return;
    }

    // Mark wallet:chain as hydrating
    const lockKey = `${walletId}:${Number(chainId)}`;
    hydratingChains.add(lockKey);

    // Check if chain has already been hydrated in Redis before proceeding with hydration
    if (!force && address) {
      try {
        console.log(`[IDB-Hydration] Checking if chain ${chainId} already hydrated in Redis for address ${address}...`);
        const { checkChainHydratedInRedis } = await import('./hydrationCheckUtils.js');
        const { isHydrated } = await checkChainHydratedInRedis(address, walletId, chainId);

        if (isHydrated) {
          console.log(`[IDB-Hydration] Chain ${chainId} already hydrated in Redis, skipping hydration`);
          // Remove from hydrating set since we're not proceeding
          hydratingChains.delete(`${walletId}:${Number(chainId)}`);
          if (onComplete) {
            const result = onComplete();
            // Await the onComplete callback if it returns a promise
            if (result && typeof result.then === 'function') {
              await result;
            }
          }
          return; // Skip hydration entirely
        }
      } catch (redisCheckError) {
        console.warn(`[IDB-Hydration] Failed to check Redis hydratedChains, proceeding with hydration:`, redisCheckError);
        // Continue with hydration if Redis check fails
      }
    }

    // Get chain manifest
    const manifest = await hydrationManager.fetchChainManifest(chainId, abortController.signal);

    // Try snapshot mode first (chain-specific)
    try {
      await hydrationManager.processChainSnapshot(walletId, chainId, manifest, abortController.signal, onProgress);
      console.log(`[IDB-Hydration] Chain ${chainId} snapshot bootstrap completed successfully`);
    } catch (snapshotError) {
      if (snapshotError.message === 'CHAIN_SNAPSHOT_NOT_AVAILABLE') {
        console.warn(`[IDB-Hydration] Chain ${chainId} snapshot not available, falling back to chunks`);
        // Fall back to chunk processing for chains
        await hydrationManager.processChainChunks(walletId, chainId, manifest, abortController.signal, onProgress);
        console.log(`[IDB-Hydration] Chain ${chainId} chunk bootstrap completed successfully`);
      } else {
        console.warn(`[IDB-Hydration] Chain ${chainId} snapshot failed with error:`, snapshotError.message);
        throw snapshotError; // Re-throw non-snapshot errors
      }
    }

    if (onComplete) {
      const result = onComplete();
      // Await the onComplete callback if it returns a promise
      if (result && typeof result.then === 'function') {
        await result;
      }
    }

  } catch (error) {
    console.error(`[IDB-Hydration] Chain ${chainId} bootstrap failed:`, error);
    if (onError) onError(error);
    throw error;
  } finally {
    // Always remove from hydrating set
    hydratingChains.delete(`${walletId}:${Number(chainId)}`);
  }
};
