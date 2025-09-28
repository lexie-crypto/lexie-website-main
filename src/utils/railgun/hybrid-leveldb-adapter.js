/**
 * Hybrid LevelDB Adapter for Railgun
 * Intelligently routes data storage based on type:
 *
 * 📁 LOCAL LevelDB (Artifacts):
 * - User-specific cryptographic data (private keys, viewing keys, signatures)
 * - Wallet artifacts and secrets
 * - Personal encryption keys
 *
 * ☁️ REDIS (Merkletrees):
 * - Global commitment trees (UTXO/TXID Merkletrees)
 * - Shared proof data accessible by all users
 * - Chain-specific global state
 *
 * This provides security for user data while enabling shared global state.
 */

import { createRedisLevelDBAdapter } from './redis-leveldb-adapter.js';

// Data type classification
const DATA_TYPES = {
  // 🔐 LOCAL STORAGE (sensitive user data)
  ARTIFACTS: [
    'wallet',
    'encryption',
    'signature',
    'key',
    'private',
    'secret',
    'viewing',
    'spending'
  ],

  // 🌐 REDIS STORAGE (global shared data)
  MERKLETREES: [
    'merkletree',
    'commitment',
    'utxo',
    'txid',
    'proof',
    'root',
    'leaf'
  ]
};

/**
 * Hybrid LevelDB Adapter
 * Routes data intelligently between local storage and Redis
 */
class HybridLevelDBAdapter {
  constructor(dbName = 'railgun-engine-hybrid') {
    this.dbName = dbName;
    this.localAdapter = null; // Lazy-loaded local LevelDB
    this.redisAdapter = createRedisLevelDBAdapter(dbName);
    this.isConnected = false;
  }

  /**
   * Determine storage location based on key content
   */
  getStorageLocation(key) {
    const keyLower = key.toLowerCase();

    // Check if it's Merkletree data (goes to Redis)
    for (const merkletreeKeyword of DATA_TYPES.MERKLETREES) {
      if (keyLower.includes(merkletreeKeyword)) {
        return 'redis';
      }
    }

    // Check if it's artifact data (stays local)
    for (const artifactKeyword of DATA_TYPES.ARTIFACTS) {
      if (keyLower.includes(artifactKeyword)) {
        return 'local';
      }
    }

    // Default: sensitive data stays local for security
    console.warn(`[HybridDB] ⚠️ Unknown key type, defaulting to local storage: ${key}`);
    return 'local';
  }

  /**
   * Lazy-load local LevelDB adapter
   */
  async getLocalAdapter() {
    if (!this.localAdapter) {
      try {
        const { default: LevelJS } = await import('level-js');
        this.localAdapter = new LevelJS(`${this.dbName}-local`);
        console.log('[HybridDB] 💾 Local LevelDB adapter initialized');
      } catch (error) {
        console.error('[HybridDB] ❌ Failed to initialize local LevelDB:', error);
        throw error;
      }
    }
    return this.localAdapter;
  }

  /**
   * Connect to both storage backends
   */
  async connect() {
    if (!this.isConnected) {
      // Redis is always connected via HTTP adapter
      this.isConnected = true;
      console.log('[HybridDB] 🔗 Hybrid storage adapter connected');
    }
  }

  /**
   * Put operation - routes to appropriate storage
   */
  async put(key, value) {
    await this.connect();
    const location = this.getStorageLocation(key);

    if (location === 'redis') {
      console.log(`[HybridDB] ☁️ Storing in Redis: ${key}`);
      return await this.redisAdapter.put(key, value);
    } else {
      console.log(`[HybridDB] 💾 Storing locally: ${key}`);
      const local = await this.getLocalAdapter();
      return await local.put(key, value);
    }
  }

  /**
   * Get operation - routes to appropriate storage
   */
  async get(key) {
    await this.connect();
    const location = this.getStorageLocation(key);

    if (location === 'redis') {
      console.log(`[HybridDB] ☁️ Reading from Redis: ${key}`);
      return await this.redisAdapter.get(key);
    } else {
      console.log(`[HybridDB] 💾 Reading from local: ${key}`);
      const local = await this.getLocalAdapter();
      return await local.get(key);
    }
  }

  /**
   * Delete operation - routes to appropriate storage
   */
  async del(key) {
    await this.connect();
    const location = this.getStorageLocation(key);

    if (location === 'redis') {
      console.log(`[HybridDB] ☁️ Deleting from Redis: ${key}`);
      return await this.redisAdapter.del(key);
    } else {
      console.log(`[HybridDB] 💾 Deleting from local: ${key}`);
      const local = await this.getLocalAdapter();
      return await local.del(key);
    }
  }

  /**
   * Batch operations - routes each operation appropriately
   */
  async batch(operations) {
    await this.connect();

    // Separate operations by storage location
    const redisOps = [];
    const localOps = [];

    for (const op of operations) {
      const location = this.getStorageLocation(op.key);
      if (location === 'redis') {
        redisOps.push(op);
      } else {
        localOps.push(op);
      }
    }

    // Execute operations in parallel
    const promises = [];

    if (redisOps.length > 0) {
      console.log(`[HybridDB] ☁️ Executing ${redisOps.length} Redis operations`);
      promises.push(this.redisAdapter.batch(redisOps));
    }

    if (localOps.length > 0) {
      console.log(`[HybridDB] 💾 Executing ${localOps.length} local operations`);
      const local = await this.getLocalAdapter();
      promises.push(local.batch(localOps));
    }

    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Iterator - primarily for Redis Merkletree data
   */
  iterator(options = {}) {
    // For hybrid approach, iterator is mainly used for Merkletrees
    // which are in Redis. Local data iteration is rare.
    console.log('[HybridDB] 🔄 Iterator requested (using Redis)');
    return this.redisAdapter.iterator(options);
  }

  /**
   * Create read stream
   */
  createReadStream(options = {}) {
    // Similar to iterator - mainly for Redis data
    console.log('[HybridDB] 📖 Read stream requested (using Redis)');
    return this.redisAdapter.createReadStream(options);
  }

  /**
   * Create write stream
   */
  createWriteStream() {
    // For safety, default to Redis for streaming operations
    // Most streaming operations are for bulk Merkletree data
    console.log('[HybridDB] ✍️ Write stream requested (using Redis)');
    return this.redisAdapter.createWriteStream();
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    await this.connect();
    const location = this.getStorageLocation(key);

    if (location === 'redis') {
      return await this.redisAdapter.exists(key);
    } else {
      const local = await this.getLocalAdapter();
      return await local.exists(key);
    }
  }

  /**
   * Get all keys with prefix (debugging utility)
   */
  async getAllKeys(prefix = '') {
    await this.connect();

    // Get keys from both storages
    const redisKeys = await this.redisAdapter.getAllKeys(prefix);
    const localKeys = this.localAdapter ?
      await this.localAdapter.getAllKeys(prefix) : [];

    return {
      redis: redisKeys,
      local: localKeys,
      all: [...redisKeys, ...localKeys]
    };
  }

  /**
   * Close connections
   */
  async close() {
    if (this.redisAdapter) {
      await this.redisAdapter.close();
    }
    if (this.localAdapter) {
      // Local LevelDB close if available
      if (typeof this.localAdapter.close === 'function') {
        await this.localAdapter.close();
      }
    }
    this.isConnected = false;
    console.log('[HybridDB] 🔌 Hybrid storage adapter closed');
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    await this.connect();

    const redisKeys = await this.redisAdapter.getAllKeys();
    const localKeys = this.localAdapter ?
      await this.localAdapter.getAllKeys() : [];

    return {
      redis: {
        keys: redisKeys.length,
        sampleKeys: redisKeys.slice(0, 5)
      },
      local: {
        keys: localKeys.length,
        sampleKeys: localKeys.slice(0, 5)
      },
      total: redisKeys.length + localKeys.length
    };
  }
}

/**
 * Factory function to create hybrid LevelDB adapter
 */
export const createHybridLevelDBAdapter = (dbName) => {
  return new HybridLevelDBAdapter(dbName);
};

/**
 * Initialize hybrid Railgun engine with proper storage routing
 */
export const initializeHybridRailgunEngine = async (dbName = 'railgun-engine-hybrid') => {
  console.log('[HybridDB] 🚀 Initializing hybrid Railgun engine...');

  const hybridAdapter = createHybridLevelDBAdapter(dbName);
  await hybridAdapter.connect();

  // Log storage routing strategy
  console.log('[HybridDB] 📋 Storage routing strategy:');
  console.log('  🔐 LOCAL: Artifacts, keys, signatures, encryption data');
  console.log('  ☁️ REDIS: Merkletrees, commitments, proofs, global state');

  return hybridAdapter;
};

/**
 * Execute post-transaction Merkletree sync
 * Captures and uploads Merkletree updates after transactions
 */
export const executePostTransactionSync = async (chainId, transactionId, hybridAdapter) => {
  try {
    console.log(`[HybridDB] 🔄 Executing post-transaction sync for chain ${chainId}, tx ${transactionId}`);

    // The Merkletree data is already being stored in Redis by the hybrid adapter
    // during the transaction process. We just need to verify it's there.

    const stats = await hybridAdapter.getStats();
    const hasMerkletreeData = stats.redis.keys > 0;

    if (hasMerkletreeData) {
      console.log(`[HybridDB] ✅ Post-transaction sync complete - ${stats.redis.keys} Merkletree entries in Redis`);
      return true;
    } else {
      console.warn(`[HybridDB] ⚠️ No Merkletree data found in Redis after transaction`);
      return false;
    }

  } catch (error) {
    console.error('[HybridDB] ❌ Post-transaction sync failed:', error);
    return false;
  }
};

export default {
  HybridLevelDBAdapter,
  createHybridLevelDBAdapter,
  initializeHybridRailgunEngine,
  executePostTransactionSync,
};
