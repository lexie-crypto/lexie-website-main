/**
 * IDB Sync Exporter
 * Reads from IndexedDB and exports data in syncable format
 */

// Dynamic import to avoid circular dependencies
let stateModule = null;

const getStateModule = async () => {
  if (!stateModule) {
    stateModule = await import('./state.js');
  }
  return stateModule;
};

/**
 * Open IndexedDB database
 */
const openIDB = async (dbName) => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      // Database should already exist, but handle upgrade gracefully
      console.warn(`[IDB-Sync-Exporter] Database ${dbName} upgraded during sync`);
    };
  });
};

/**
 * Get all records from a store since cursor
 */
const getRecordsSinceCursor = async (db, storeName, cursor) => {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const records = [];

    let request;
    if (cursor) {
      // Start from cursor (assuming string keys)
      request = store.openCursor(IDBKeyRange.lowerBound(cursor, true));
    } else {
      // Full scan
      request = store.openCursor();
    }

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        records.push({
          key: cursor.key,
          value: cursor.value
        });
        cursor.continue();
      } else {
        resolve(records);
      }
    };

    request.onerror = () => reject(request.error);
  });
};

/**
 * Convert record to NDJSON line
 */
const recordToNDJSON = (record) => {
  const line = {
    t: Date.now(), // timestamp
    k: record.key, // key
    v: record.value // value
  };

  // Handle binary data (convert to base64)
  if (record.value && typeof record.value === 'object') {
    // Check for Uint8Array or ArrayBuffer
    if (record.value instanceof Uint8Array) {
      line.v = { _type: 'Uint8Array', data: btoa(String.fromCharCode(...record.value)) };
    } else if (record.value instanceof ArrayBuffer) {
      const uint8 = new Uint8Array(record.value);
      line.v = { _type: 'ArrayBuffer', data: btoa(String.fromCharCode(...uint8)) };
    }
  }

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
 * Export data from IndexedDB store
 */
export const exportStore = async (dbName, storeName) => {
  try {
    console.log(`[IDB-Sync-Exporter] Exporting ${storeName} from ${dbName}`);

    const db = await openIDB(dbName);
    const stateMod = await getStateModule();
    const cursor = stateMod.getSyncCursor(`${dbName}:${storeName}`);
    const records = await getRecordsSinceCursor(db, storeName, cursor);

    if (records.length === 0) {
      console.log(`[IDB-Sync-Exporter] No new records in ${storeName}`);
      return { records: [], ndjson: '', hash: '', lastKey: cursor };
    }

    // Convert to NDJSON
    const ndjsonLines = records.map(recordToNDJSON);
    const ndjson = ndjsonLines.join('\n') + '\n';
    const hash = await calculateHash(ndjson);

    const lastKey = records[records.length - 1]?.key || cursor;

    console.log(`[IDB-Sync-Exporter] Exported ${records.length} records from ${storeName}`, {
      size: ndjson.length,
      hash: hash.substring(0, 8) + '...',
      lastKey
    });

    return {
      records,
      ndjson,
      hash,
      lastKey
    };

  } catch (error) {
    console.error(`[IDB-Sync-Exporter] Failed to export ${storeName}:`, error);
    throw error;
  }
};

/**
 * Chunk NDJSON data into manageable pieces
 */
export const chunkData = (ndjson, maxChunkSize = 2 * 1024 * 1024) => { // 2MB default
  const chunks = [];
  let currentChunk = '';
  const lines = ndjson.split('\n');

  for (const line of lines) {
    if (line.trim() === '') continue; // Skip empty lines

    const newChunk = currentChunk + line + '\n';

    if (newChunk.length > maxChunkSize && currentChunk.length > 0) {
      // Current chunk would exceed limit, save it and start new
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    } else {
      currentChunk = newChunk;
    }
  }

  // Add remaining chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Create sync manifest
 */
export const createManifest = async (dbName, storeName, timestamp, chunks, totalRecords) => {
  const chunkInfo = await Promise.all(
    chunks.map(async (chunk, index) => ({
      index,
      size: chunk.length,
      hash: await calculateHash(chunk)
    }))
  );

  return {
    dbName,
    storeName,
    timestamp,
    totalChunks: chunks.length,
    totalRecords,
    chunks: chunkInfo
  };
};

/**
 * Export and prepare data for sync
 */
export const prepareSyncData = async (walletId, dbName, storeName) => {
  try {
    const exportResult = await exportStore(dbName, storeName);

    if (exportResult.records.length === 0) {
      return null; // Nothing to sync
    }

    const chunks = chunkData(exportResult.ndjson);
    const timestamp = Date.now();
    const manifest = await createManifest(dbName, storeName, timestamp, chunks, exportResult.records.length);

    console.log(`[IDB-Sync-Exporter] Prepared sync data for ${storeName}`, {
      totalRecords: exportResult.records.length,
      totalChunks: chunks.length,
      totalSize: chunks.reduce((size, chunk) => size + chunk.length, 0)
    });

    return {
      walletId,
      dbName,
      storeName,
      timestamp,
      chunks,
      manifest,
      lastKey: exportResult.lastKey
    };

  } catch (error) {
    console.error(`[IDB-Sync-Exporter] Failed to prepare sync data for ${storeName}:`, error);
    throw error;
  }
};
