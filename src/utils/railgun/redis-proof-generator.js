/**
 * Redis-based Proof Generator
 * Generates transaction proofs using centralized Redis Merkletree data
 * Replaces local LevelDB-based proof generation for faster, shared Merkletrees
 */

import { getRedisMerkletreeAdapter } from './redis-merkletree-adapter.js';

/**
 * Generate a Merkle proof for a UTXO using Redis-stored Merkletree
 * @param {number} chainId - Chain ID
 * @param {number} utxoIndex - Index of the UTXO in the Merkletree
 * @returns {Promise<Object>} Proof data with path and root
 */
export const generateUTXOProofFromRedis = async (chainId, utxoIndex) => {
  try {
    console.log(`[RedisProof] 🔍 Generating UTXO proof from Redis for chain ${chainId}, index ${utxoIndex}...`);

    // Get Redis Merkletree adapter
    const redisTree = await getRedisMerkletreeAdapter(chainId, 'utxo');
    if (!redisTree) {
      throw new Error(`Redis Merkletree adapter not available for chain ${chainId}`);
    }

    // Get the Merkle proof
    const proof = await redisTree.getMerkleProof(utxoIndex);
    const root = await redisTree.getRootHash();

    if (!proof || !root) {
      throw new Error(`Failed to generate proof for UTXO ${utxoIndex} on chain ${chainId}`);
    }

    const proofData = {
      chainId,
      treeType: 'utxo',
      utxoIndex,
      proof,
      root,
      timestamp: Date.now()
    };

    console.log(`[RedisProof] ✅ Generated UTXO proof for index ${utxoIndex}`);
    return proofData;

  } catch (error) {
    console.error(`[RedisProof] ❌ Failed to generate UTXO proof:`, error);
    throw error;
  }
};

/**
 * Generate a TXID Merkle proof using Redis-stored Merkletree
 * @param {number} chainId - Chain ID
 * @param {number} txidIndex - Index of the TXID in the Merkletree
 * @returns {Promise<Object>} Proof data with path and root
 */
export const generateTXIDProofFromRedis = async (chainId, txidIndex) => {
  try {
    console.log(`[RedisProof] 🔍 Generating TXID proof from Redis for chain ${chainId}, index ${txidIndex}...`);

    // Get Redis Merkletree adapter
    const redisTree = await getRedisMerkletreeAdapter(chainId, 'txid');
    if (!redisTree) {
      throw new Error(`Redis Merkletree adapter not available for chain ${chainId}`);
    }

    // Get the Merkle proof
    const proof = await redisTree.getMerkleProof(txidIndex);
    const root = await redisTree.getRootHash();

    if (!proof || !root) {
      throw new Error(`Failed to generate proof for TXID ${txidIndex} on chain ${chainId}`);
    }

    const proofData = {
      chainId,
      treeType: 'txid',
      txidIndex,
      proof,
      root,
      timestamp: Date.now()
    };

    console.log(`[RedisProof] ✅ Generated TXID proof for index ${txidIndex}`);
    return proofData;

  } catch (error) {
    console.error(`[RedisProof] ❌ Failed to generate TXID proof:`, error);
    throw error;
  }
};

/**
 * Generate complete transaction proof data using Redis Merkletrees
 * @param {number} chainId - Chain ID
 * @param {Array} utxoIndices - Array of UTXO indices to include
 * @param {Array} txidIndices - Array of TXID indices to include
 * @returns {Promise<Object>} Complete proof data for transaction
 */
export const generateTransactionProofFromRedis = async (chainId, utxoIndices = [], txidIndices = []) => {
  try {
    console.log(`[RedisProof] 🚀 Generating transaction proof from Redis for chain ${chainId}...`);
    console.log(`[RedisProof] 📊 UTXO indices: [${utxoIndices.join(', ')}]`);
    console.log(`[RedisProof] 📊 TXID indices: [${txidIndices.join(', ')}]`);

    const proofData = {
      chainId,
      timestamp: Date.now(),
      utxoProofs: [],
      txidProofs: []
    };

    // Generate UTXO proofs
    for (const utxoIndex of utxoIndices) {
      const utxoProof = await generateUTXOProofFromRedis(chainId, utxoIndex);
      proofData.utxoProofs.push(utxoProof);
    }

    // Generate TXID proofs
    for (const txidIndex of txidIndices) {
      const txidProof = await generateTXIDProofFromRedis(chainId, txidIndex);
      proofData.txidProofs.push(txidProof);
    }

    // Verify all proofs share the same root (Merkletree consistency)
    const utxoRoots = [...new Set(proofData.utxoProofs.map(p => p.root))];
    const txidRoots = [...new Set(proofData.txidProofs.map(p => p.root))];

    if (utxoRoots.length > 1) {
      throw new Error(`Inconsistent UTXO roots: ${utxoRoots.join(', ')}`);
    }

    if (txidRoots.length > 1) {
      throw new Error(`Inconsistent TXID roots: ${txidRoots.join(', ')}`);
    }

    proofData.utxoRoot = utxoRoots[0];
    proofData.txidRoot = txidRoots[0];

    console.log(`[RedisProof] ✅ Generated complete transaction proof with ${utxoIndices.length} UTXO and ${txidIndices.length} TXID proofs`);
    return proofData;

  } catch (error) {
    console.error(`[RedisProof] ❌ Failed to generate transaction proof:`, error);
    throw error;
  }
};

/**
 * Validate a proof against Redis-stored Merkletree
 * @param {number} chainId - Chain ID
 * @param {string} treeType - 'utxo' or 'txid'
 * @param {number} leafIndex - Index of the leaf
 * @param {Array} proof - Proof path
 * @param {string} expectedRoot - Expected root hash (optional)
 * @returns {Promise<boolean>} Whether proof is valid
 */
export const validateProofAgainstRedis = async (chainId, treeType, leafIndex, proof, expectedRoot = null) => {
  try {
    console.log(`[RedisProof] 🔍 Validating ${treeType} proof for chain ${chainId}, index ${leafIndex}...`);

    const redisTree = await getRedisMerkletreeAdapter(chainId, treeType);
    if (!redisTree) {
      throw new Error(`Redis Merkletree adapter not available for chain ${chainId}`);
    }

    // Get the current root from Redis
    const currentRoot = await redisTree.getRootHash();

    // Use provided root or current root
    const rootToValidate = expectedRoot || currentRoot;

    if (!rootToValidate) {
      throw new Error(`No root available for validation`);
    }

    // Get the leaf value
    const leaf = await redisTree.getLeaf(leafIndex);
    if (!leaf) {
      throw new Error(`Leaf not found at index ${leafIndex}`);
    }

    // Validate the proof
    const isValid = await redisTree.validateProof(leaf, leafIndex, proof, rootToValidate);

    console.log(`[RedisProof] ${isValid ? '✅' : '❌'} Proof validation ${isValid ? 'PASSED' : 'FAILED'}`);
    return isValid;

  } catch (error) {
    console.error(`[RedisProof] ❌ Proof validation failed:`, error);
    return false;
  }
};

/**
 * Get Merkletree statistics from Redis
 * @param {number} chainId - Chain ID
 * @returns {Promise<Object>} Tree statistics
 */
export const getRedisMerkletreeStats = async (chainId) => {
  try {
    const utxoTree = await getRedisMerkletreeAdapter(chainId, 'utxo');
    const txidTree = await getRedisMerkletreeAdapter(chainId, 'txid');

    const stats = {
      chainId,
      utxoTree: {
        height: utxoTree ? await utxoTree.getTreeLength() : 0,
        root: utxoTree ? await utxoTree.getRootHash() : null,
        synced: utxoTree ? await utxoTree.isTreeSynced() : false
      },
      txidTree: {
        height: txidTree ? await txidTree.getTreeLength() : 0,
        root: txidTree ? await txidTree.getRootHash() : null,
        synced: txidTree ? await txidTree.isTreeSynced() : false
      },
      timestamp: Date.now()
    };

    console.log(`[RedisProof] 📊 Merkletree stats for chain ${chainId}:`, stats);
    return stats;

  } catch (error) {
    console.error(`[RedisProof] ❌ Failed to get Merkletree stats:`, error);
    return null;
  }
};

export default {
  generateUTXOProofFromRedis,
  generateTXIDProofFromRedis,
  generateTransactionProofFromRedis,
  validateProofAgainstRedis,
  getRedisMerkletreeStats,
};
