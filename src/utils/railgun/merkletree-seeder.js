/**
 * Merkletree Seeder - Proxy-based merkletree state sharing
 *
 * Enables fast wallet creation by pre-seeding LevelDB with merkletree data
 * from Redis via the wallet-metadata proxy instead of scanning from genesis.
 */

import LevelJS from 'level-js';

// LevelDB key prefixes we want to copy
const MERKLETREE_PREFIX = 'merkletree-erc20';
const SYNC_INFO_PREFIX = 'chain_sync_info';

// Proxy endpoint helper
const callMerkletreeProxy = async (subaction, chainId, method = 'GET', body = null) => {
  const params = new URLSearchParams({
    action: 'merkletree-data',
    subaction,
    chainId: chainId.toString()
  });

  const url = `/api/wallet-metadata?${params.toString()}`;

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (body && method === 'POST') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }

  return result;
};

/**
 * Extract merkletree data from a completed scan for sharing
 */
export async function extractMerkletreeData(chainId, dbName = 'railgun-engine-db') {
  console.log(`[MerkletreeSeeder] Extracting merkletree data for chain ${chainId}`);

  const db = new LevelJS(dbName);
  await db.open();

  try {
    const merkletreeData = {};
    const syncInfoData = {};

    // Iterate through all keys in LevelDB
    const iterator = db.iterator();
    let totalKeys = 0;
    let sampleKeys = [];

    for await (const [key, value] of iterator) {
      const keyStr = key.toString();
      totalKeys++;

      // Keep sample of first 10 keys for debugging
      if (sampleKeys.length < 10) {
        sampleKeys.push({
          key: keyStr.substring(0, 100) + (keyStr.length > 100 ? '...' : ''),
          length: keyStr.length,
          startsWithMerkletree: keyStr.startsWith(MERKLETREE_PREFIX),
          startsWithSync: keyStr.startsWith(SYNC_INFO_PREFIX)
        });
      }

      if (keyStr.startsWith(MERKLETREE_PREFIX)) {
        merkletreeData[keyStr] = value.toString();
      } else if (keyStr.startsWith(SYNC_INFO_PREFIX)) {
        syncInfoData[keyStr] = value.toString();
      }
    }

    await iterator.end();

    console.log(`[MerkletreeSeeder] Database scan complete:`, {
      totalKeys,
      sampleKeys,
      merkletreeMatches: Object.keys(merkletreeData).length,
      syncInfoMatches: Object.keys(syncInfoData).length
    });

    console.log(`[MerkletreeSeeder] Extracted ${Object.keys(merkletreeData).length} merkletree keys`);
    console.log(`[MerkletreeSeeder] Extracted ${Object.keys(syncInfoData).length} sync info keys`);

    return {
      merkletreeData,
      syncInfoData,
      extractedAt: Date.now(),
      chainId
    };

  } finally {
    await db.close();
  }
}

/**
 * Store extracted merkletree data via proxy (Redis keys used by backend)
 *
 * Backend stores data in Redis with these keys:
 * - `railgun:merkletree:chain:${chainId}` (hash) - merkletree data
 * - `railgun:merkletree:chain:${chainId}:syncinfo` (hash) - sync info
 * - `railgun:merkletree:chain:${chainId}:meta` (string) - metadata JSON
 */
export async function storeMerkletreeInRedis(chainId, extractedData) {
  console.log(`[MerkletreeSeeder] Storing merkletree data for chain ${chainId} via proxy`);

  const data = {
    merkletreeData: extractedData.merkletreeData,
    syncInfoData: extractedData.syncInfoData,
    extractedAt: extractedData.extractedAt,
    chainId: extractedData.chainId
  };

  await callMerkletreeProxy('store-data', chainId, 'POST', data);
  console.log(`[MerkletreeSeeder] Stored merkletree data for chain ${chainId} via proxy`);
}

/**
 * Check if merkletree data is available via proxy
 */
export async function hasMerkletreeData(chainId) {
  try {
    const result = await callMerkletreeProxy('has-data', chainId, 'GET');
    return result.hasData === true;
  } catch (error) {
    console.warn(`[MerkletreeSeeder] Failed to check data availability for chain ${chainId}:`, error.message);
    return false;
  }
}

/**
 * Load merkletree data via proxy and inject into LevelDB
 */
export async function injectMerkletreeData(chainId, dbName = 'railgun-engine-db') {
  console.log(`[MerkletreeSeeder] Injecting merkletree data for chain ${chainId} via proxy`);

  try {
    const result = await callMerkletreeProxy('get-data', chainId, 'GET');

    if (!result.merkletreeData || Object.keys(result.merkletreeData).length === 0) {
      console.log(`[MerkletreeSeeder] No merkletree data available for chain ${chainId}`);
      return false;
    }

    // Open LevelDB and inject data
    const db = new LevelJS(dbName);
    await db.open();

    try {
      const batch = db.batch();

      // Inject merkletree data
      for (const [key, value] of Object.entries(result.merkletreeData)) {
        batch.put(key, Buffer.from(value, 'utf8'));
      }

      // Inject sync info data
      if (result.syncInfoData) {
        for (const [key, value] of Object.entries(result.syncInfoData)) {
          batch.put(key, Buffer.from(value, 'utf8'));
        }
      }

      await batch.write();

      console.log(`[MerkletreeSeeder] Injected ${Object.keys(result.merkletreeData).length} merkletree keys`);
      if (result.syncInfoData) {
        console.log(`[MerkletreeSeeder] Injected ${Object.keys(result.syncInfoData).length} sync info keys`);
      }

      return true;

    } finally {
      await db.close();
    }

  } catch (error) {
    console.warn(`[MerkletreeSeeder] Failed to inject merkletree data for chain ${chainId}:`, error.message);
    return false;
  }
}

/**
 * Check if merkletree data is still valid via proxy
 */
export async function validateMerkletreeData(chainId) {
  try {
    const result = await callMerkletreeProxy('validate-data', chainId, 'GET');
    return result.isValid === true;
  } catch (error) {
    console.warn(`[MerkletreeSeeder] Failed to validate data for chain ${chainId}:`, error.message);
    return false;
  }
}
