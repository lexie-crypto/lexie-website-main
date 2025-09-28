/**
 * Redis Merkletree Adapter
 * Fetches Merkle proof data from centralized Redis storage instead of local LevelDB
 * Enables wallets to use shared Merkletree data for proof generation
 */

// Using backend merkletree routes through wallet-metadata proxy

/**
 * Redis-based Merkletree adapter that mimics the SDK's Merkletree interface
 * but fetches data from centralized Redis storage
 */

// Backend API helper functions
const API_BASE_URL = '/api/wallet-metadata/merkletree';

/**
 * Make authenticated API call to backend merkletree routes
 */
async function makeMerkletreeApiCall(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get Merkle tree data from backend
 */
async function getMerkleTreeData(chainId, treeType, leafIndex = null) {
  const endpoint = leafIndex !== null
    ? `/get/${chainId}-${treeType}-${leafIndex}`
    : `/get/${chainId}-${treeType}`;

  const response = await makeMerkletreeApiCall(endpoint);
  return response.success ? response.data.value : null;
}

/**
 * Get Merkle proof from Redis backend
 */
async function getMerkleProofFromRedis(chainId, treeType, leafIndex) {
  // Use the same getMerkleTreeData function since proofs are stored as tree data
  return await getMerkleTreeData(chainId, treeType, leafIndex);
}
export class RedisMerkletreeAdapter {
  constructor(chainId, treeType) {
    this.chainId = chainId;
    this.treeType = treeType; // 'utxo' or 'txid'
    this.cache = new Map(); // Local cache for frequently accessed data
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get tree root hash
   */
  async getRootHash() {
    const cacheKey = 'root';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const treeData = await getMerkleTreeData(this.chainId, this.treeType);
    const root = treeData?.root || null;

    this.setCache(cacheKey, root);
    return root;
  }

  /**
   * Get tree length/height
   */
  async getTreeLength() {
    const cacheKey = 'height';
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const treeData = await getMerkleTreeData(this.chainId, this.treeType);
    const height = treeData?.height || 0;

    this.setCache(cacheKey, height);
    return height;
  }

  /**
   * Get leaf at specific index
   */
  async getLeaf(index) {
    const cacheKey = `leaf:${index}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const treeData = await getMerkleTreeData(this.chainId, this.treeType, index);
    const leaf = treeData?.requestedLeaf?.hash || null;

    this.setCache(cacheKey, leaf);
    return leaf;
  }

  /**
   * Get Merkle proof for leaf at specific index
   */
  async getMerkleProof(index) {
    const cacheKey = `proof:${index}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const proofData = await getMerkleProofFromRedis(this.chainId, this.treeType, index);
    const proof = proofData?.proof || [];

    this.setCache(cacheKey, proof);
    return proof;
  }

  /**
   * Validate that leaf exists at index with given proof
   */
  async validateProof(leaf, index, proof) {
    const root = await this.getRootHash();
    if (!root) return false;

    // Use the same validation logic as merkletree-utils.js
    let currentHash = leaf;

    for (let i = 0; i < proof.length; i++) {
      const isLeft = (index >> i) % 2 === 0;
      const sibling = proof[i];

      if (isLeft) {
        currentHash = hashPair(currentHash, sibling);
      } else {
        currentHash = hashPair(sibling, currentHash);
      }
    }

    return currentHash === root;
  }

  /**
   * Check if tree has been synced recently
   */
  async isTreeSynced(maxAgeMs = 10 * 60 * 1000) { // 10 minutes default
    const treeData = await getMerkleTreeData(this.chainId, this.treeType);
    if (!treeData) return false;

    const lastSync = treeData.lastSync || 0;
    return (Date.now() - lastSync) < maxAgeMs;
  }

  /**
   * Get cache entry if valid
   */
  getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.cacheExpiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cache entry
   */
  setCache(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Clear local cache
   */
  clearCache() {
    this.cache.clear();
    console.log(`[RedisMerkletree] 🧹 Cleared cache for ${this.treeType} tree on chain ${this.chainId}`);
  }
}

/**
 * Simple hash function (should match SDK's Poseidon hash)
 */
function hashPair(left, right) {
  // This is a placeholder - actual implementation should use
  // the same Poseidon hash function as the Railgun SDK
  return `hash(${left},${right})`;
}

/**
 * Factory function to create Redis Merkletree adapters
 */
export const createRedisMerkletree = (chainId, treeType) => {
  return new RedisMerkletreeAdapter(chainId, treeType);
};

/**
 * Check if Redis Merkletree is available and synced for a chain
 */
export const isRedisMerkletreeAvailable = async (chainId, treeType) => {
  try {
    const adapter = new RedisMerkletreeAdapter(chainId, treeType);
    const isSynced = await adapter.isTreeSynced();
    const height = await adapter.getTreeLength();

    return {
      available: isSynced && height > 0,
      height,
      isSynced,
      chainId,
      treeType
    };
  } catch (error) {
    console.warn('[RedisMerkletree] Error checking availability:', error.message);
    return {
      available: false,
      height: 0,
      isSynced: false,
      chainId,
      treeType,
      error: error.message
    };
  }
};

export default {
  RedisMerkletreeAdapter,
  createRedisMerkletree,
  isRedisMerkletreeAvailable,
};
