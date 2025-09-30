/**
 * IDB Full Snapshot Exporter
 * Creates byte-for-byte copies of LevelJS-backed IndexedDB to Redis
 */

// Dynamic import to avoid circular dependencies
let stateModule = null;

const getStateModule = async () => {
  if (!stateModule) {
    stateModule = await import('./state.js');
  }
  return stateModule;
};

// Target chunk size for NDJSON (accounting for base64 + JSON overhead)
// Aim for ~2MB final payload (conservative for Vercel limits)
const CHUNK_TARGET_BYTES = Math.floor(2 * 1024 * 1024 * 0.8); // ~1.6MB

/**
 * Open LevelJS-backed IndexedDB database
 */
const openLevelJSDB = async () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('level-js-railgun-engine-db');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      console.warn(`[IDB-Snapshot] Database level-js-railgun-engine-db upgraded during sync`);
    };
  });
};

/**
 * Encode binary data to base64
 */
const encodeBase64 = (data) => {
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } else if (data instanceof Uint8Array) {
    let binary = '';
    for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  } else {
    // For other types, try to convert to string first
    return btoa(String(data));
  }
};

/**
 * Decode base64 to Uint8Array
 */
const decodeBase64 = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * Convert record to NDJSON line with base64 encoding
 */
const recordToNDJSON = (record) => {
  const line = {
    k_b64: encodeBase64(record.key), // base64 encoded key
    v_b64: encodeBase64(record.value) // base64 encoded value
  };
  return JSON.stringify(line);
};

/**
 * Calculate SHA-256 hash of data
 */
const calculateHash = async (data) => {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Create manifest for snapshot
 */
const createManifest = (walletId, timestamp, totalRecords, totalBytes, chunkCount, overallHash, chunkHashes = []) => {
  return {
    walletId,
    timestamp,
    totalRecords,
    totalBytes,
    chunkCount,
    overallHash,
    chunkHashes, // Individual chunk hashes for verification
    version: '1.0',
    format: 'idb-snapshot'
  };
};


/**
 * Export full database snapshot
 */
export const exportFullSnapshot = async (walletId, signal) => {
  try {
    console.log(`[IDB-Snapshot] Starting full database export for wallet ${walletId}`);

    const db = await openLevelJSDB();

    // Check if the store exists
    if (!db.objectStoreNames.contains('railgun-engine-db')) {
      throw new Error('LevelJS store railgun-engine-db not found');
    }

    const transaction = db.transaction(['railgun-engine-db'], 'readonly');
    const store = transaction.objectStore('railgun-engine-db');

    // Get resumability info
    const stateMod = await getStateModule();
    const lastKeyB64 = stateMod.getSnapshotCursor(walletId);
    let lastKey = null;

    if (lastKeyB64) {
      try {
        const uint8Key = decodeBase64(lastKeyB64);
        lastKey = uint8Key.buffer.slice(uint8Key.byteOffset, uint8Key.byteOffset + uint8Key.byteLength);
        console.log(`[IDB-Snapshot] Resuming from key: ${lastKeyB64.substring(0, 16)}...`);
      } catch (e) {
        console.warn('[IDB-Snapshot] Invalid resume key, starting from beginning');
      }
    }

    return new Promise((resolve, reject) => {
      let recordCount = 0;
      let totalBytes = 0;
      const chunks = [];
      let currentChunk = '';
      const timestamp = Date.now();

      let request;
      if (lastKey) {
        request = store.openCursor(IDBKeyRange.lowerBound(lastKey, true));
      } else {
        request = store.openCursor();
      }

      request.onsuccess = async (event) => {
        if (signal?.aborted) {
          reject(new Error('Export aborted'));
          return;
        }

        const cursor = event.target.result;
        if (cursor) {
          // Convert record to NDJSON line
          const ndjsonLine = recordToNDJSON({ key: cursor.key, value: cursor.value }) + '\n';
          const lineBytes = ndjsonLine.length;

          // Check if adding this line would exceed target chunk size
          if (currentChunk.length + lineBytes > CHUNK_TARGET_BYTES && currentChunk.length > 0) {
            // Save current chunk and start new one
            chunks.push(currentChunk);
            currentChunk = ndjsonLine;
          } else {
            currentChunk += ndjsonLine;
          }

          recordCount++;
          totalBytes += lineBytes;

          // Save progress every 100 records
          if (recordCount % 100 === 0) {
            const currentKeyB64 = encodeBase64(cursor.key);
            stateMod.setSnapshotCursor(walletId, currentKeyB64);
            console.log(`[IDB-Snapshot] Exported ${recordCount} records so far...`);
          }

          cursor.continue();
        } else {
          // Export complete - finalize chunks and create manifest
          console.log(`[IDB-Snapshot] Export complete: ${recordCount} total records`);

          if (recordCount === 0 && chunks.length === 0 && currentChunk.length === 0) {
            resolve(null); // Nothing to export
            return;
          }

          // Add final chunk if it has content
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
          }

          // Calculate hashes for each chunk
          const chunkHashes = [];
          for (const chunk of chunks) {
            const chunkHash = await calculateHash(chunk);
            chunkHashes.push(chunkHash);
          }

          // Calculate overall hash from all chunks
          const allData = chunks.join('');
          const overallHash = await calculateHash(allData);

          // Create manifest with chunk hashes
          const manifest = createManifest(
            walletId,
            timestamp,
            recordCount,
            totalBytes,
            chunks.length,
            overallHash,
            chunkHashes
          );

          // Clear resume cursor
          stateMod.clearSnapshotCursor(walletId);

          console.log(`[IDB-Snapshot] Created ${chunks.length} chunks, ${totalBytes} bytes total`);

          resolve({
            manifest,
            chunks,
            timestamp,
            recordCount,
            totalBytes
          });
        }
      };

      request.onerror = () => {
        console.error('[IDB-Snapshot] Export failed:', request.error);
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[IDB-Snapshot] Export failed:', error);
    throw error;
  }
};

/**
 * Export chain-specific snapshot (only data for specified chain)
 */
export const exportChainSnapshot = async (walletId, chainId, signal) => {
  try {
    console.log(`[IDB-Snapshot] Starting chain-specific export for wallet ${walletId} on chain ${chainId}`);

    const db = await openLevelJSDB();

    // Check if the store exists
    if (!db.objectStoreNames.contains('railgun-engine-db')) {
      throw new Error('LevelJS store railgun-engine-db not found');
    }

    const transaction = db.transaction(['railgun-engine-db'], 'readonly');
    const store = transaction.objectStore('railgun-engine-db');

    // Get resumability info (chain-specific)
    const stateMod = await getStateModule();
    const lastKeyB64 = stateMod.getSnapshotCursor(walletId + `:chain:${chainId}`);
    let lastKey = null;

    if (lastKeyB64) {
      try {
        const uint8Key = decodeBase64(lastKeyB64);
        lastKey = uint8Key.buffer.slice(uint8Key.byteOffset, uint8Key.byteOffset + uint8Key.byteLength);
        console.log(`[IDB-Snapshot] Resuming chain ${chainId} from key: ${lastKeyB64.substring(0, 16)}...`);
      } catch (e) {
        console.warn('[IDB-Snapshot] Invalid resume key for chain, starting from beginning');
      }
    }

    return new Promise((resolve, reject) => {
      let recordCount = 0;
      let totalBytes = 0;
      const chunks = [];
      let currentChunk = '';
      const timestamp = Date.now();

      let request;
      if (lastKey) {
        request = store.openCursor(IDBKeyRange.lowerBound(lastKey, true));
      } else {
        request = store.openCursor();
      }

      request.onsuccess = async (event) => {
        if (signal?.aborted) {
          reject(new Error('Chain export aborted'));
          return;
        }

        const cursor = event.target.result;
        if (cursor) {
          // Filter records by chain ID
          const keyStr = cursor.key.toString();
          const isChainRecord = keyStr.startsWith(`${chainId}:`);

          if (isChainRecord) {
            // Convert record to NDJSON line
            const ndjsonLine = recordToNDJSON({ key: cursor.key, value: cursor.value }) + '\n';
            const lineBytes = ndjsonLine.length;

            // Check if adding this line would exceed target chunk size
            if (currentChunk.length + lineBytes > CHUNK_TARGET_BYTES && currentChunk.length > 0) {
              // Save current chunk and start new one
              chunks.push(currentChunk);
              currentChunk = ndjsonLine;
            } else {
              currentChunk += ndjsonLine;
            }

            recordCount++;
            totalBytes += lineBytes;

            // Save progress every 50 records (less frequent than full export)
            if (recordCount % 50 === 0) {
              const currentKeyB64 = encodeBase64(cursor.key);
              stateMod.setSnapshotCursor(walletId + `:chain:${chainId}`, currentKeyB64);
              console.log(`[IDB-Snapshot] Chain ${chainId} exported ${recordCount} records so far...`);
            }
          }

          cursor.continue();
        } else {
          // Export complete - finalize chunks and create manifest
          console.log(`[IDB-Snapshot] Chain ${chainId} export complete: ${recordCount} total records`);

          if (recordCount === 0 && chunks.length === 0 && currentChunk.length === 0) {
            resolve(null); // Nothing to export for this chain
            return;
          }

          // Add final chunk if it has content
          if (currentChunk.trim()) {
            chunks.push(currentChunk);
          }

          // Calculate hashes for each chunk
          const chunkHashes = [];
          for (const chunk of chunks) {
            const chunkHash = await calculateHash(chunk);
            chunkHashes.push(chunkHash);
          }

          // Calculate overall hash from all chunks
          const allData = chunks.join('');
          const overallHash = await calculateHash(allData);

          // Create manifest with chunk hashes
          const manifest = createManifest(
            walletId,
            timestamp,
            recordCount,
            totalBytes,
            chunkHashes,
            overallHash,
            chunks.length
          );

          // Clear snapshot cursor after successful export
          stateMod.clearSnapshotCursor(walletId + `:chain:${chainId}`);

          resolve({
            manifest,
            chunks,
            timestamp,
            recordCount,
            totalBytes,
            chainId
          });
        }
      };

      request.onerror = () => {
        console.error('[IDB-Snapshot] Chain export failed');
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[IDB-Snapshot] Chain export failed:', error);
    throw error;
  }
};

/**
 * Restore full database snapshot
 */
export const restoreFullSnapshot = async (walletId, timestamp, signal) => {
  try {
    console.log(`[IDB-Snapshot] Starting restore for wallet ${walletId} at ${timestamp}`);

    // This would be implemented to fetch chunks from Redis and restore to IndexedDB
    // For now, return a placeholder
    console.warn('[IDB-Snapshot] Restore not yet implemented');
    return { success: false, reason: 'not_implemented' };

  } catch (error) {
    console.error('[IDB-Snapshot] Restore failed:', error);
    throw error;
  }
};