/**
 * Redis-Only LevelDB Adapter
 * Complete replacement for LevelDB that stores everything in Redis
 * Mimics LevelDB interface for drop-in replacement
 */

class RedisOnlyAdapter {
  constructor(dbName = 'railgun-redis-only') {
    this.dbName = dbName;
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    this.isOpen = false;
    console.log(`[RedisOnlyAdapter] Created for database: ${dbName}`);
  }

  /**
   * Open the database (no-op for Redis)
   */
  async open(options = {}) {
    if (this.isOpen) return this;
    this.isOpen = true;
    console.log(`[RedisOnlyAdapter] Opened database: ${this.dbName}`);
    return this;
  }

  /**
   * Get a value by key
   */
  async get(key) {
    try {
      const encodedKey = encodeURIComponent(key);
      const response = await fetch(`${this.baseUrl}/api/wallet-metadata/merkletree/get/${encodedKey}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 404) {
        // Key not found - mimic LevelDB behavior
        const error = new Error(`Key not found: ${key}`);
        error.notFound = true;
        throw error;
      }

      if (!response.ok) {
        throw new Error(`Redis get failed: ${response.status}`);
      }

      const result = await response.json();
      return result.success ? result.data.value : null;

    } catch (error) {
      // Re-throw LevelDB-style errors
      if (error.notFound) throw error;

      console.error(`[RedisOnlyAdapter] Get error for key ${key}:`, error);
      throw new Error(`Database get error: ${error.message}`);
    }
  }

  /**
   * Put a key-value pair
   */
  async put(key, value) {
    try {
      const response = await fetch(`${this.baseUrl}/api/wallet-metadata/merkletree/store`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: key,
          value: typeof value === 'string' ? value : JSON.stringify(value)
        }),
      });

      if (!response.ok) {
        throw new Error(`Redis put failed: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(`Redis put failed: ${result.error}`);
      }

      return this;

    } catch (error) {
      console.error(`[RedisOnlyAdapter] Put error for key ${key}:`, error);
      throw new Error(`Database put error: ${error.message}`);
    }
  }

  /**
   * Delete a key
   */
  async del(key) {
    try {
      const encodedKey = encodeURIComponent(key);
      const response = await fetch(`${this.baseUrl}/api/wallet-metadata/merkletree/delete/${encodedKey}`, {
        method: 'DELETE',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Redis delete failed: ${response.status}`);
      }

      const result = await response.json();
      return result.success ? result.data.deleted : false;

    } catch (error) {
      console.error(`[RedisOnlyAdapter] Delete error for key ${key}:`, error);
      throw new Error(`Database delete error: ${error.message}`);
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    try {
      const encodedKey = encodeURIComponent(key);
      const response = await fetch(`${this.baseUrl}/api/wallet-metadata/merkletree/exists/${encodedKey}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return false;
      }

      const result = await response.json();
      return result.success ? result.data.exists : false;

    } catch (error) {
      console.error(`[RedisOnlyAdapter] Exists error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Create a key stream for iteration
   */
  createKeyStream(options = {}) {
    let keys = [];
    let index = 0;
    let ended = false;

    const stream = {
      on: (event, callback) => {
        if (event === 'data') {
          // Lazy load keys on first data request
          if (keys.length === 0 && !ended) {
            this._loadKeys(options).then(loadedKeys => {
              keys = loadedKeys;
              // Emit keys one by one
              const emitNext = () => {
                if (index < keys.length) {
                  callback(keys[index]);
                  index++;
                  // Use setTimeout to avoid blocking
                  setTimeout(emitNext, 0);
                } else {
                  ended = true;
                  stream.emit('end');
                }
              };
              emitNext();
            }).catch(error => {
              console.error('[RedisOnlyAdapter] Key stream error:', error);
              stream.emit('error', error);
            });
          }
        }
        return stream;
      },

      emit: (event, ...args) => {
        // Simple event emitter for 'end' and 'error'
        if (event === 'end' && stream._endCallback) {
          stream._endCallback();
        }
        if (event === 'error' && stream._errorCallback) {
          stream._errorCallback(...args);
        }
        return stream;
      }
    };

    return stream;
  }

  /**
   * Create a read stream
   */
  createReadStream(options = {}) {
    return this.createKeyStream(options);
  }

  /**
   * Load keys from Redis (used by streams)
   */
  async _loadKeys(options = {}) {
    try {
      const params = new URLSearchParams();
      if (options.gt) params.append('gt', options.gt);
      if (options.lt) params.append('lt', options.lt);
      if (options.prefix) params.append('prefix', options.prefix);
      if (options.limit) params.append('limit', options.limit.toString());

      const queryString = params.toString();
      const url = `${this.baseUrl}/api/wallet-metadata/merkletree/keys${queryString ? '?' + queryString : ''}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Redis keys failed: ${response.status}`);
      }

      const result = await response.json();
      return result.success ? result.data.keys : [];

    } catch (error) {
      console.error('[RedisOnlyAdapter] Load keys error:', error);
      throw error;
    }
  }

  /**
   * Batch operations
   */
  async batch(operations) {
    try {
      const batchOps = operations.map(op => ({
        type: op.type,
        key: op.key,
        value: op.value
      }));

      const response = await fetch(`${this.baseUrl}/api/wallet-metadata/merkletree/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operations: batchOps }),
      });

      if (!response.ok) {
        throw new Error(`Redis batch failed: ${response.status}`);
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(`Redis batch failed: ${result.error}`);
      }

      return this;

    } catch (error) {
      console.error('[RedisOnlyAdapter] Batch error:', error);
      throw new Error(`Database batch error: ${error.message}`);
    }
  }

  /**
   * Close database (no-op for Redis)
   */
  async close() {
    this.isOpen = false;
    console.log(`[RedisOnlyAdapter] Closed database: ${this.dbName}`);
    return this;
  }

  /**
   * Clear all data (dangerous - use with caution)
   */
  async clear() {
    console.warn(`[RedisOnlyAdapter] Clear operation not implemented for Redis - too dangerous`);
    throw new Error('Clear operation not supported for Redis backend');
  }
}

/**
 * Create a Redis-only adapter instance
 */
export function createRedisOnlyAdapter(dbName = 'railgun-redis-only') {
  return new RedisOnlyAdapter(dbName);
}

/**
 * Factory function to create Redis-only database
 */
export function createRedisOnlyDB(dbName = 'railgun-redis-only') {
  const adapter = new RedisOnlyAdapter(dbName);
  return adapter.open();
}

export default RedisOnlyAdapter;
