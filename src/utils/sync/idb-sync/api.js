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
 */
export const uploadChunk = async (walletId, dbName, timestamp, chunkIndex, totalChunks, data, hash) => {
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
 * Upload snapshot manifest to Redis
 */
export const uploadSnapshotManifest = async (walletId, timestamp, manifest) => {
  const action = 'snapshot-manifest';
  const payload = {
    walletId,
    timestamp,
    manifest
  };

  return await makeSyncRequest(action, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};

/**
 * Upload snapshot chunk to Redis
 */
export const uploadSnapshotChunk = async (walletId, timestamp, chunkIndex, chunkData, totalChunks) => {
  const action = 'snapshot-chunk';
  const payload = {
    walletId,
    timestamp,
    chunkIndex,
    chunkData,
    // Add fields needed for queuing
    dbName: 'railgun-snapshot', // Placeholder for queuing
    totalChunks,
    data: chunkData,
    hash: await calculateHash(chunkData)
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
          type: 'snapshot' // Mark as snapshot chunk
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
 * Finalize snapshot upload
 */
export const finalizeSnapshotUpload = async (walletId, timestamp) => {
  const action = 'snapshot-finalize';
  const payload = {
    walletId,
    timestamp
  };

  return await makeSyncRequest(action, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
};
