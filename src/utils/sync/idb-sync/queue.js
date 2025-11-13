/**
 * IDB Sync Queue
 * Handles offline sync with retry logic and backpressure management
 */


// Queue storage in IndexedDB
const QUEUE_DB_NAME = 'LexieSyncQueue';
const QUEUE_STORE_NAME = 'chunks';
const MAX_QUEUE_SIZE = 200 * 1024 * 1024; // 200MB hard cap
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1000; // 1s base, exponential

/**
 * Open IndexedDB for queue storage
 */
const openQueueDB = async () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        const store = db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

/**
 * Add chunk to sync queue
 */
export const enqueueChunk = async (chunk) => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    const queueItem = {
      id: `${chunk.walletId}-${chunk.dbName}-${chunk.chunkIndex}-${Date.now()}`,
      ...chunk,
      status: 'pending',
      timestamp: Date.now(),
      retryCount: 0,
      lastError: null
    };

    await new Promise((resolve, reject) => {
      const request = store.add(queueItem);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log(`[IDB-Sync-Queue] Enqueued chunk ${chunk.chunkIndex} for ${chunk.dbName}`, {
      walletId: chunk.walletId,
      size: chunk.data.length
    });

    // Check queue size and enforce limits
    await enforceQueueLimits(db);

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to enqueue chunk:', error);
    throw error;
  }
};

/**
 * Process queued chunks (retry failed uploads)
 */
export const processQueue = async () => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(QUEUE_STORE_NAME);
    const index = store.index('status');

    const pendingChunks = await new Promise((resolve, reject) => {
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (pendingChunks.length === 0) {
      return;
    }

    console.log(`[IDB-Sync-Queue] Processing ${pendingChunks.length} queued chunks`);

    // Sort by timestamp (oldest first)
    pendingChunks.sort((a, b) => a.timestamp - b.timestamp);

    for (const chunk of pendingChunks) {
      try {
        // Check if retry is due (exponential backoff)
        const timeSinceLastAttempt = Date.now() - (chunk.lastAttempt || 0);
        const backoffDelay = RETRY_BACKOFF_MS * Math.pow(2, chunk.retryCount || 0);

        if (timeSinceLastAttempt < backoffDelay) {
          continue; // Not ready for retry yet
        }

        // Attempt to sync this chunk
        await syncQueuedChunk(chunk);

        // Success - remove from queue
        await removeFromQueue(chunk.id);

      } catch (error) {
        // Update retry count and error
        await updateQueueItem(chunk.id, {
          retryCount: (chunk.retryCount || 0) + 1,
          lastError: error.message,
          lastAttempt: Date.now(),
          status: (chunk.retryCount || 0) >= MAX_RETRIES ? 'failed' : 'pending'
        });

        if ((chunk.retryCount || 0) >= MAX_RETRIES) {
          console.error(`[IDB-Sync-Queue] Chunk ${chunk.id} failed permanently after ${MAX_RETRIES} retries`);
        }
      }
    }

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to process queue:', error);
  }
};

/**
 * Sync a queued chunk (called by processQueue)
 */
const syncQueuedChunk = async (chunk) => {
  const { makeSyncRequest } = await import('./api.js');

  // Use appropriate action based on chunk type
  const action = chunk.type === 'snapshot' ? 'snapshot-chunk' : 'sync-chunk';

  await makeSyncRequest(`/api/artifacts?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletId: chunk.walletId,
      dbName: chunk.dbName,
      timestamp: chunk.timestamp,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      data: chunk.data,
      hash: chunk.hash,
      chunkData: chunk.data // For snapshot compatibility
    })
  });
};

/**
 * Update queue item status
 */
const updateQueueItem = async (id, updates) => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    const existing = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!existing) return;

    const updated = { ...existing, ...updates };

    await new Promise((resolve, reject) => {
      const request = store.put(updated);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to update queue item:', error);
  }
};

/**
 * Remove item from queue
 */
const removeFromQueue = async (id) => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to remove from queue:', error);
  }
};

/**
 * Enforce queue size limits by removing oldest items
 */
const enforceQueueLimits = async (db) => {
  try {
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    // Get all items to calculate total size
    const allItems = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    let totalSize = 0;
    for (const item of allItems) {
      totalSize += JSON.stringify(item).length;
    }

    if (totalSize <= MAX_QUEUE_SIZE) {
      return; // Under limit
    }

    console.warn(`[IDB-Sync-Queue] Queue size ${totalSize} exceeds limit ${MAX_QUEUE_SIZE}, cleaning up`);

    // Remove oldest items until under limit
    const sortedItems = allItems.sort((a, b) => a.timestamp - b.timestamp);

    for (const item of sortedItems) {
      if (totalSize <= MAX_QUEUE_SIZE) break;

      await new Promise((resolve, reject) => {
        const request = store.delete(item.id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      totalSize -= JSON.stringify(item).length;
      console.log(`[IDB-Sync-Queue] Removed old chunk ${item.id} to free space`);
    }

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to enforce queue limits:', error);
  }
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    const allItems = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const stats = {
      total: allItems.length,
      pending: allItems.filter(item => item.status === 'pending').length,
      failed: allItems.filter(item => item.status === 'failed').length,
      totalSize: allItems.reduce((size, item) => size + JSON.stringify(item).length, 0)
    };

    return stats;

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to get queue stats:', error);
    return { total: 0, pending: 0, failed: 0, totalSize: 0 };
  }
};

/**
 * Clear the queue (useful for debugging)
 */
export const clearQueue = async () => {
  try {
    const db = await openQueueDB();
    const transaction = db.transaction([QUEUE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    await new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[IDB-Sync-Queue] Cleared sync queue');

  } catch (error) {
    console.error('[IDB-Sync-Queue] Failed to clear queue:', error);
  }
};
