/**
 * IDB Sync API
 * Makes requests to artifacts.js proxy which handles HMAC signing
 */

// Dynamic import to avoid circular dependencies
let queueModule = null;

const getQueueModule = async () => {
  if (!queueModule) {
    queueModule = await import('./queue.js');
  }
  return queueModule;
};

/**
 * Check if error is network-related
 */
const isNetworkError = (error) => {
  return error.name === 'TypeError' ||
         error.message.includes('fetch') ||
         error.message.includes('network') ||
         error.message.includes('Failed to fetch');
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
 * Make sync request through artifacts proxy
 * The proxy handles HMAC signing server-side
 */
export const makeSyncRequest = async (action, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Request-ID': Math.random().toString(36).substring(7),
    ...options.headers
  };

  try {
    console.debug(`[IDB-Sync-API] Making request for action: ${action}`, {
      method: options.method || 'GET'
    });

    const url = `/api/artifacts?action=${action}`;
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.debug('[IDB-Sync-API] Request successful');

    return result;

  } catch (error) {
    console.error('[IDB-Sync-API] Request failed:', error);

    // If it's a network error and we have data to sync, enqueue for later
    if (options.body && (error.message.includes('fetch') || error.message.includes('network'))) {
      try {
        const bodyData = JSON.parse(options.body);
        if (bodyData.walletId && bodyData.dbName) {
          console.log('[IDB-Sync-API] Enqueueing chunk for offline sync');
          const queueMod = await getQueueModule();
          await queueMod.enqueueChunk({
            walletId: bodyData.walletId,
            dbName: bodyData.dbName,
            timestamp: bodyData.timestamp,
            chunkIndex: bodyData.chunkIndex,
            totalChunks: bodyData.totalChunks,
            data: bodyData.data,
            hash: bodyData.hash
          });
        }
      } catch (enqueueError) {
        console.error('[IDB-Sync-API] Failed to enqueue chunk:', enqueueError);
      }
    }

    throw error;
  }
};

/**
 * Upload chunk to backend via artifacts proxy
 * Handles 413 auto-split as fallback for oversized chunks
 */
export const uploadChunk = async (walletId, dbName, timestamp, chunkIndex, totalChunks, data, hash, retryCount = 0) => {
  try {
    return await makeSyncRequest('sync-chunk', {
      method: 'POST',
      body: JSON.stringify({
        walletId,
        dbName,
        timestamp,
        chunkIndex,
        totalChunks,
        data,
        hash
      })
    });
  } catch (error) {
    // Handle 413 Payload Too Large errors by splitting chunk into ~3MB pieces
    if (error.message.includes('413') && retryCount < 3) {
      console.warn(`[IDB-Sync-API] Chunk ${chunkIndex} too large (413), splitting into 3MB pieces...`);

      // Split into ~3MB pieces (accounting for base64 overhead)
      const targetPieceSize = Math.floor(3 * 1024 * 1024 * 0.8); // ~2.4MB NDJSON target
      const numPieces = Math.ceil(data.length / targetPieceSize);
      const actualPieceSize = Math.ceil(data.length / numPieces);

      console.log(`[IDB-Sync-API] Splitting ${data.length} bytes into ${numPieces} pieces of ~${actualPieceSize} bytes each`);

      // Upload each piece
      for (let i = 0; i < numPieces; i++) {
        const start = i * actualPieceSize;
        const end = Math.min(start + actualPieceSize, data.length);
        const piece = data.substring(start, end);
        const pieceHash = await calculateHash(piece);

        await uploadChunk(walletId, dbName, timestamp, chunkIndex * numPieces + i, totalChunks * numPieces, piece, pieceHash, retryCount + 1);
      }

      // Return success for the original chunk
      return { success: true, split: true, pieces: numPieces };
    }

    // Re-throw other errors
    throw error;
  }
};

/**
 * Finalize sync session via artifacts proxy
 */
export const finalizeSync = async (walletId, dbName, timestamp, manifest) => {
  return await makeSyncRequest('sync-finalize', {
    method: 'POST',
    body: JSON.stringify({
      walletId,
      dbName,
      timestamp,
      manifest
    })
  });
};

/**
 * Get sync manifest via artifacts proxy
 */
export const getSyncManifest = async (walletId, dbName) => {
  return await makeSyncRequest(`sync-manifest&walletId=${walletId}&dbName=${dbName}`);
};

/**
 * Upload snapshot manifest to Redis (reuse existing sync endpoints with snapshot flag)
 */
export const uploadSnapshotManifest = async (walletId, timestamp, manifest) => {
  const action = 'sync-manifest';
  const payload = {
    walletId,
    timestamp,
    manifest,
    isSnapshot: true // Flag to indicate this is a full snapshot
  };

  return await makeSyncRequest(action, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

/**
 * Upload snapshot chunk to Redis (reuse existing sync endpoints with snapshot flag)
 */
export const uploadSnapshotChunk = async (walletId, timestamp, chunkIndex, chunkData, totalChunks) => {
  const action = 'sync-chunk';
  const payload = {
    walletId,
    timestamp,
    chunkIndex,
    chunkData,
    // Add fields needed for queuing
    dbName: 'railgun-snapshot', // Placeholder for queuing
    totalChunks,
    data: chunkData,
    hash: await calculateHash(chunkData),
    isSnapshot: true // Flag to indicate this is a full snapshot chunk
  };

  try {
    return await makeSyncRequest(action, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  } catch (error) {
    // If upload fails, try to enqueue for later retry
    if (isNetworkError(error)) {
      console.log(`[IDB-Sync-API] Network error, enqueuing snapshot chunk ${chunkIndex}`);
      try {
        const queueMod = await getQueueModule();
        await queueMod.enqueueChunk({
          walletId,
          dbName: 'railgun-snapshot',
          timestamp,
          chunkIndex,
          totalChunks,
          data: chunkData,
          hash: payload.hash,
          type: 'snapshot', // Mark as snapshot chunk
          isSnapshot: true
        });
        console.log(`[IDB-Sync-API] Snapshot chunk ${chunkIndex} enqueued for retry`);
      } catch (enqueueError) {
        console.error('[IDB-Sync-API] Failed to enqueue snapshot chunk:', enqueueError);
      }
    }
    throw error;
  }
};

/**
 * Finalize snapshot upload (reuse existing sync endpoints with snapshot flag)
 */
export const finalizeSnapshotUpload = async (walletId, timestamp) => {
  const action = 'sync-finalize';
  const payload = {
    walletId,
    timestamp,
    isSnapshot: true // Flag to indicate this is a full snapshot finalization
  };

  return await makeSyncRequest(action, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

/**
 * HYDRATION/SYNC API - Download from Redis to IDB
 */

/**
 * Get latest snapshot manifest for hydration
 */
export const getLatestManifest = async (walletId) => {
  const action = `idb-sync-latest&walletId=${walletId}`;
  return await makeSyncRequest(encodeURIComponent(action));
};

/**
 * Get a specific chunk for hydration
 */
export const getSyncChunk = async (walletId, timestamp, chunkIndex) => {
  const action = `idb-sync-chunk&walletId=${walletId}&ts=${timestamp}&n=${chunkIndex}`;
  return await makeSyncRequest(encodeURIComponent(action));
};
