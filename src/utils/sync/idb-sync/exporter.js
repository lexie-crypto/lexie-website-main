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
// HTTP payload limit: ~2-3MB compressed to avoid 413 errors
const CHUNK_TARGET_BYTES = Math.floor(2.5 * 1024 * 1024 * 0.8); // ~2MB uncompressed

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
 * Check if a vault has already been created in this LevelDB
 * @returns {Promise<boolean>} True if vault already exists
 */
const checkVaultExists = async () => {
  try {
    console.log('[IDB-Vault-Check] Checking if vault already exists...');

    const db = await openLevelJSDB();
    const transaction = db.transaction(['railgun-engine-db'], 'readonly');
    const store = transaction.objectStore('railgun-engine-db');

    return new Promise((resolve, reject) => {
      const request = store.get('lexie:vault:created');

      request.onsuccess = () => {
        db.close();
        const exists = request.result !== undefined;
        console.log(`[IDB-Vault-Check] Vault ${exists ? 'already exists' : 'does not exist'} in this browser`);
        resolve(exists);
      };

      request.onerror = () => {
        console.error('[IDB-Vault-Check] Vault check failed:', request.error);
        db.close();
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[IDB-Vault-Check] Vault check failed:', error);
    throw error;
  }
};

/**
 * Mark that a vault has been created in this LevelDB
 * @returns {Promise<void>}
 */
const markVaultCreated = async () => {
  try {
    console.log('[IDB-Vault-Mark] Marking vault as created...');

    const db = await openLevelJSDB();
    const transaction = db.transaction(['railgun-engine-db'], 'readwrite');
    const store = transaction.objectStore('railgun-engine-db');

    return new Promise((resolve, reject) => {
      const request = store.put({
        created: true,
        timestamp: Date.now()
      }, 'lexie:vault:created');

      request.onsuccess = () => {
        db.close();
        console.log('[IDB-Vault-Mark] Vault creation marked successfully');
        resolve();
      };

      request.onerror = () => {
        console.error('[IDB-Vault-Mark] Failed to mark vault creation:', request.error);
        db.close();
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[IDB-Vault-Mark] Failed to mark vault creation:', error);
    throw error;
  }
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
 * Compress data using brotli (better compression than gzip), fallback to uncompressed
 */
const compressChunk = async (data) => {
  try {
    // Check if CompressionStream is available (modern browsers)
    if (typeof CompressionStream !== 'undefined') {
      // Try brotli first (better compression), fallback to gzip
      let format = 'brotli';
      let stream;

      try {
        stream = new CompressionStream('brotli');
      } catch (brotliError) {
        console.warn('[IDB-Snapshot] Brotli not supported, falling back to gzip');
        format = 'gzip';
        stream = new CompressionStream('gzip');
      }

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();

      // Convert string to Uint8Array
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);

      // Compress
      const writePromise = writer.write(dataBuffer);
      writer.close();

      const chunks = [];
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) chunks.push(value);
      }

      const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        compressed.set(chunk, offset);
        offset += chunk.length;
      }

      return {
        data: compressed,
        compressed: true,
        format: format, // 'brotli' or 'gzip'
        originalSize: dataBuffer.length,
        compressedSize: compressed.length
      };
    } else {
      // Fallback: return uncompressed data
      const encoder = new TextEncoder();
      return {
        data: encoder.encode(data),
        compressed: false,
        originalSize: data.length,
        compressedSize: data.length
      };
    }
  } catch (error) {
    console.warn('[IDB-Snapshot] Compression failed, using uncompressed:', error);
    const encoder = new TextEncoder();
    return {
      data: encoder.encode(data),
      compressed: false,
      originalSize: data.length,
      compressedSize: data.length
    };
  }
};


/**
 * Create manifest for snapshot
 */
const createManifest = (walletId, timestamp, totalRecords, totalBytes, chunkCount, overallHash, chunkHashes = [], compressionInfo = null) => {
  return {
    walletId,
    timestamp,
    totalRecords,
    totalBytes,
    chunkCount,
    overallHash,
    chunkHashes, // Individual chunk hashes for verification
    compression: compressionInfo, // Compression statistics and metadata
    version: '2.0', // Updated for compression support
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
            // Compress and save current chunk, then start new one
            const compressedChunk = await compressChunk(currentChunk);
            chunks.push({
              data: compressedChunk.data,
              compressed: compressedChunk.compressed,
              originalSize: compressedChunk.originalSize,
              compressedSize: compressedChunk.compressedSize
            });
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
            const compressedChunk = await compressChunk(currentChunk);
            chunks.push({
              data: compressedChunk.data,
              compressed: compressedChunk.compressed,
              originalSize: compressedChunk.originalSize,
              compressedSize: compressedChunk.compressedSize
            });
          }

          // Calculate hashes for each chunk (hash the compressed data)
          const chunkHashes = [];
          for (const chunk of chunks) {
            // Convert Uint8Array back to string for hashing (maintains compatibility)
            const chunkString = new TextDecoder().decode(chunk.data);
            const chunkHash = await calculateHash(chunkString);
            chunkHashes.push(chunkHash);
          }

          // Calculate overall hash from all chunks (avoid string length limit)
          // Use Merkle tree approach: hash concatenation of individual chunk hashes
          let overallHash;
          if (chunks.length === 1) {
            // Single chunk - hash the chunk string
            const chunkString = new TextDecoder().decode(chunks[0].data);
            overallHash = await calculateHash(chunkString);
          } else {
            // Multiple chunks - hash concatenation of chunk hashes (Merkle tree root)
            const concatenatedHashes = chunkHashes.join('');
            overallHash = await calculateHash(concatenatedHashes);
          }

          // Calculate compression stats
          const totalOriginalSize = chunks.reduce((sum, chunk) => sum + chunk.originalSize, 0);
          const totalCompressedSize = chunks.reduce((sum, chunk) => sum + chunk.compressedSize, 0);
          const compressionRatio = totalOriginalSize > 0 ? `${((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(1)}%` : '0%';

          // Create manifest with chunk hashes and compression info
          const manifest = createManifest(
            walletId,
            timestamp,
            recordCount,
            totalBytes,
            chunks.length,
            overallHash,
            chunkHashes,
            {
              compressed: true,
              totalOriginalSize,
              totalCompressedSize,
              compressionRatio,
              chunksCompressed: chunks.filter(c => c.compressed).length
            }
          );

          // Clear resume cursor
          stateMod.clearSnapshotCursor(walletId);

          console.log(`[IDB-Snapshot] Created ${chunks.length} chunks, ${totalBytes} bytes NDJSON (${totalCompressedSize} bytes compressed, ${compressionRatio} ratio)`);

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

/**
 * Export complete LevelDB snapshot for backup purposes
 * Captures entire IndexedDB state for guaranteed restoration
 * @param {string} walletId - Wallet ID to export data for
 * @returns {Promise<Object|null>} Complete LevelDB snapshot or null if no data
 */
const exportWalletSnapshot = async (walletId) => {
  try {
    console.log('[IDB-Snapshot-Export] Creating complete LevelDB snapshot for backup...');

    const db = await openLevelJSDB();
    const transaction = db.transaction(['railgun-engine-db'], 'readonly');
    const store = transaction.objectStore('railgun-engine-db');

    const records = [];
    let recordCount = 0;
    let totalBytes = 0;
    const timestamp = Date.now();

    return new Promise((resolve, reject) => {
      // Use cursor to iterate through ALL records in LevelDB
      const request = store.openCursor();

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor) {
          const key = cursor.key;
          const value = cursor.value;

          // Export EVERYTHING - this is a complete LevelDB snapshot
          const k_b64 = encodeBase64(key);
          const v_b64 = encodeBase64(value);

          records.push({ k_b64, v_b64 });
          recordCount++;
          totalBytes += (k_b64.length + v_b64.length);

          // Log what we're backing up (truncated for readability)
          const keyStr = typeof key === 'string' ? key :
                        key instanceof ArrayBuffer ? new TextDecoder().decode(key) : String(key);
          console.log(`[IDB-Snapshot-Export] Backing up record: ${keyStr.slice(0, 50)}...`);

          cursor.continue();
        } else {
          // Finished iterating - close DB
          db.close();

          if (records.length === 0) {
            console.log('[IDB-Snapshot-Export] No data found in LevelDB');
            resolve(null);
            return;
          }

          // Convert to NDJSON format
          const ndjsonData = records.map(record => JSON.stringify(record)).join('\n');

          console.log(`[IDB-Snapshot-Export] Complete LevelDB snapshot created:`, {
            recordCount,
            totalBytes,
            ndjsonLength: ndjsonData.length,
            timestamp: new Date(timestamp).toISOString()
          });

          resolve({
            ndjsonData,
            recordCount,
            totalBytes,
            timestamp,
            walletId
          });
        }
      };

      request.onerror = () => {
        console.error('[IDB-Snapshot-Export] Export failed:', request.error);
        db.close();
        reject(request.error);
      };
    });

  } catch (error) {
    console.error('[IDB-Snapshot-Export] Export failed:', error);
    throw error;
  }
};

// Export functions for use in backup module
export { exportWalletSnapshot, checkVaultExists, markVaultCreated };