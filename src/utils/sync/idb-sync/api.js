/**
 * IDB Sync API
 * Makes requests to artifacts.js proxy which handles HMAC signing
 */

import { enqueueChunk } from './queue.js';

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
          await enqueueChunk({
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
