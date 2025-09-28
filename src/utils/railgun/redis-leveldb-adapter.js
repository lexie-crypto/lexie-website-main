/**
 * Backend-backed LevelDB Adapter
 * Implements LevelDB interface using backend API endpoints
 * Allows Railgun SDK to use centralized Redis storage via secure API calls
 * Uses existing wallet-metadata proxy infrastructure with HMAC authentication
 */

// Configuration for backend API calls through wallet-metadata proxy
const API_BASE_URL = 'https://lexiecrypto.com';
const MERKLETREE_API_BASE = '/api/wallet-metadata/merkletree';  

// HMAC signature generation for backend authentication
function generateHmacSignature(method, path, timestamp, secret) {
  const payload = `${method}:${path}:${timestamp}`;
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// LevelDB-compatible interface using backend API
class BackendLevelDBAdapter {
  constructor(dbName = 'railgun-backend-db') {
    this.dbName = dbName;
    this.isConnected = true; // HTTP is always "connected"
    this.pendingOperations = new Map(); // Track pending batch operations
  }

  /**
   * Generate LevelDB key for API calls
   */
  getKey(key) {
    return `${this.dbName}:${key}`;
  }

  /**
   * Make authenticated API call to backend
   */
  async makeApiCall(method, endpoint, body = null) {
    const timestamp = Date.now().toString();
    const path = endpoint;
    const secret = process.env.LEXIE_HMAC_SECRET || 'development-secret';

    const signature = generateHmacSignature(method, path, timestamp, secret);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': API_BASE_URL,
      'User-Agent': 'BackendLevelDBAdapter/1.0',
    };

    const url = `${API_BASE_URL}${endpoint}`;

    console.log(`[BackendLevelDB] 📡 ${method} ${url}`);

    try {
      const fetchOptions = {
        method,
        headers,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'API call failed');
      }

      return result;
    } catch (error) {
      console.error(`[BackendLevelDB] ❌ API call failed:`, error);
      throw error;
    }
  }

  /**
   * Put operation - Store key-value pair via backend API
   */
  async put(key, value) {
    const fullKey = this.getKey(key);

    // Serialize value if it's not a string
    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);

    const result = await this.makeApiCall('POST', `${MERKLETREE_API_BASE}/store`, {
      key: fullKey,
      value: serializedValue,
      operation: 'put'
    });

    console.log(`[BackendLevelDB] 💾 Stored key: ${key}`);
    return result;
  }

  /**
   * Get operation - Retrieve value by key via backend API
   */
  async get(key) {
    const fullKey = this.getKey(key);

    const result = await this.makeApiCall('GET', `${MERKLETREE_API_BASE}/get/${encodeURIComponent(fullKey)}`);

    if (!result.data) {
      throw new Error('Key not found');
    }

    const value = result.data.value;

    // Try to parse as JSON, fallback to string
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Del operation - Delete key via backend API
   */
  async del(key) {
    const fullKey = this.getKey(key);

    const result = await this.makeApiCall('DELETE', `${MERKLETREE_API_BASE}/delete/${encodeURIComponent(fullKey)}`);

    console.log(`[BackendLevelDB] 🗑️ Deleted key: ${key}`);
    return result.data?.deleted || false;
  }

  /**
   * Batch operations via backend API
   */
  async batch(operations) {
    const formattedOps = operations.map(op => ({
      type: op.type,
      key: this.getKey(op.key),
      value: op.type === 'put' ? (typeof op.value === 'string' ? op.value : JSON.stringify(op.value)) : undefined
    }));

    const result = await this.makeApiCall('POST', `${MERKLETREE_API_BASE}/batch`, {
      operations: formattedOps
    });

    console.log(`[BackendLevelDB] 📦 Executed batch of ${operations.length} operations`);
    return result.data?.results || [];
  }

  /**
   * Iterator for range queries (simplified - uses backend API)
   */
  iterator(options = {}) {
    let results = [];
    let currentIndex = 0;
    let finished = false;

    return {
      async next() {
        if (finished) {
          return { done: true };
        }

        if (currentIndex >= results.length) {
          // Fetch more results from backend
          try {
            const result = await this.makeApiCall('GET', `${MERKLETREE_API_BASE}/iterate`, {
              prefix: options.gte || options.gt || '',
              limit: options.limit || 100,
              offset: currentIndex
            });
            results = result.data?.keys || [];
            finished = results.length === 0;
          } catch (error) {
            finished = true;
            return { done: true };
          }
        }

        if (currentIndex < results.length) {
          const key = results[currentIndex];
          currentIndex++;
          return {
            value: {
              key: key.replace(`${this.dbName}:`, ''),
              value: await this.get(key.replace(`${this.dbName}:`, ''))
            },
            done: false
          };
        }

        return { done: true };
      },

      async end() {
        results = [];
        currentIndex = 0;
        finished = true;
      }
    };
  }

  /**
   * Create read stream (simplified)
   */
  createReadStream(options = {}) {
    const iterator = this.iterator(options);
    let ended = false;

    return {
      on: (event, callback) => {
        if (event === 'data') {
          // Start reading data
          (async () => {
            try {
              while (!ended) {
                const result = await iterator.next();
                if (result.done) break;
                callback(result.value);
              }
              if (!ended) {
                ended = true;
                this.emit('end');
              }
            } catch (error) {
              if (!ended) {
                ended = true;
                this.emit('error', error);
              }
            }
          })();
        } else if (event === 'end') {
          this._endCallback = callback;
        } else if (event === 'error') {
          this._errorCallback = callback;
        }
      },

      emit: (event, data) => {
        if (event === 'end' && this._endCallback) {
          this._endCallback();
        } else if (event === 'error' && this._errorCallback) {
          this._errorCallback(data);
        }
      }
    };
  }

  /**
   * Create write stream (simplified)
   */
  createWriteStream() {
    let batch = [];

    return {
      write: (data) => {
        batch.push(data);
      },
      end: async () => {
        if (batch.length > 0) {
          await this.batch(batch);
          batch = [];
        }
      }
    };
  }

  /**
   * Close connection (no-op for HTTP)
   */
  async close() {
    this.isConnected = false;
    console.log('[BackendLevelDB] 🔌 HTTP adapter closed');
  }

  /**
   * Check if key exists via backend API
   */
  async exists(key) {
    const fullKey = this.getKey(key);

    try {
      const result = await this.makeApiCall('GET', `${MERKLETREE_API_BASE}/exists/${encodeURIComponent(fullKey)}`);
      return result.data?.exists || false;
    } catch {
      return false;
    }
  }

  /**
   * Get all keys with prefix via backend API
   */
  async getAllKeys(prefix = '') {
    const result = await this.makeApiCall('GET', `${MERKLETREE_API_BASE}/keys`, {
      prefix: `${this.dbName}:${prefix}`
    });

    return (result.data?.keys || []).map(key => key.replace(`${this.dbName}:`, ''));
  }
}

/**
 * Factory function to create backend LevelDB adapter
 */
export const createRedisLevelDBAdapter = (dbName) => {
  return new BackendLevelDBAdapter(dbName);
};

/**
 * Merkletree-specific backend operations using merkletree-sync API
 */
export class BackendMerkletreeStorage {
  constructor(chainId) {
    this.chainId = chainId;
  }

  /**
   * Store Merkletree leaf via merkletree-sync API
   */
  async storeLeaf(treeType, index, leafData) {
    const result = await this.makeApiCall('POST', '/api/merkletree-sync', {
      chainId: this.chainId,
      operation: 'storeLeaf',
      treeType,
      index,
      leafData
    });
    return result;
  }

  /**
   * Get Merkletree leaf via merkletree-sync API
   */
  async getLeaf(treeType, index) {
    const result = await this.makeApiCall('GET', `/api/merkletree-sync/leaf/${this.chainId}/${treeType}/${index}`);
    return result.data?.leafData;
  }

  /**
   * Store tree root via merkletree-sync API
   */
  async storeRoot(treeType, root) {
    const result = await this.makeApiCall('POST', '/api/merkletree-sync', {
      chainId: this.chainId,
      operation: 'storeRoot',
      treeType,
      root
    });
    return result;
  }

  /**
   * Get tree root via merkletree-sync API
   */
  async getRoot(treeType) {
    const result = await this.makeApiCall('GET', `/api/merkletree-sync/root/${this.chainId}/${treeType}`);
    return result.data?.root;
  }

  /**
   * Store tree height via merkletree-sync API
   */
  async storeHeight(treeType, height) {
    const result = await this.makeApiCall('POST', '/api/merkletree-sync', {
      chainId: this.chainId,
      operation: 'storeHeight',
      treeType,
      height
    });
    return result;
  }

  /**
   * Get tree height via merkletree-sync API
   */
  async getHeight(treeType) {
    const result = await this.makeApiCall('GET', `/api/merkletree-sync/height/${this.chainId}/${treeType}`);
    return result.data?.height || 0;
  }

  /**
   * Make authenticated API call
   */
  async makeApiCall(method, endpoint, body = null) {
    const timestamp = Date.now().toString();
    const path = endpoint;
    const secret = process.env.LEXIE_HMAC_SECRET || 'development-secret';

    const signature = generateHmacSignature(method, path, timestamp, secret);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Lexie-Timestamp': timestamp,
      'X-Lexie-Signature': signature,
      'Origin': API_BASE_URL,
      'User-Agent': 'BackendMerkletreeStorage/1.0',
    };

    const url = `${API_BASE_URL}${endpoint}`;

    console.log(`[BackendMerkletree] 📡 ${method} ${url}`);

    try {
      const fetchOptions = {
        method,
        headers,
        signal: AbortSignal.timeout(10000),
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'API call failed');
      }

      return result;
    } catch (error) {
      console.error(`[BackendMerkletree] ❌ API call failed:`, error);
      throw error;
    }
  }
}

export default {
  BackendLevelDBAdapter,
  BackendMerkletreeStorage,
  createRedisLevelDBAdapter,
};
