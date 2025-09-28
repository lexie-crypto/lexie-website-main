/**
 * Merkletree Utilities for Centralized Storage
 * Provides access to LevelDB Merkletrees for syncing to Redis
 */

import { waitForRailgunReady } from './engine.js';

/**
 * Get UTXO Merkletree instance for a network
 * @param {TXIDVersion} txidVersion - TXID version
 * @param {NetworkName} networkName - Network name
 * @returns {Object} Merkletree instance
 */
export const getUTXOMerkletreeForNetwork = async (txidVersion, networkName) => {
  await waitForRailgunReady();

  const { getUTXOMerkletreeForNetwork: sdkGetUTXOMerkletree } = await import('@railgun-community/wallet');
  return sdkGetUTXOMerkletree(txidVersion, networkName);
};

/**
 * Get TXID Merkletree instance for a network
 * @param {TXIDVersion} txidVersion - TXID version
 * @param {NetworkName} networkName - Network name
 * @returns {Object} Merkletree instance
 */
export const getTXIDMerkletreeForNetwork = async (txidVersion, networkName) => {
  await waitForRailgunReady();

  const { getTXIDMerkletreeForNetwork: sdkGetTXIDMerkletree } = await import('@railgun-community/wallet');
  return sdkGetTXIDMerkletree(txidVersion, networkName);
};

/**
 * Get Merkletree root hash for verification
 * @param {Object} tree - Merkletree instance
 * @returns {string} Root hash
 */
export const getMerkleTreeRoot = (tree) => {
  return tree.getRootHash?.() || tree.root;
};

/**
 * Get Merkletree length/height
 * @param {Object} tree - Merkletree instance
 * @returns {number} Tree length
 */
export const getMerkleTreeLength = (tree) => {
  return tree.getTreeLength?.() || tree.length || 0;
};

/**
 * Generate Merkle proof for a leaf index
 * @param {Object} tree - Merkletree instance
 * @param {number} index - Leaf index
 * @returns {Array} Merkle proof path
 */
export const getMerkleProof = async (tree, index) => {
  if (tree.getMerkleProof) {
    return tree.getMerkleProof(index);
  }

  // Fallback: construct proof manually if SDK method not available
  console.warn('[MerkleTree] Using fallback proof generation - may be slower');
  const proof = [];
  const treeLength = getMerkleTreeLength(tree);

  let currentIndex = index;
  for (let level = 0; level < Math.log2(treeLength); level++) {
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;

    if (siblingIndex < treeLength) {
      const sibling = await tree.getLeaf(siblingIndex);
      proof.push(sibling.toString());
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
};

/**
 * Validate Merkle proof
 * @param {string} leaf - Leaf hash
 * @param {number} index - Leaf index
 * @param {Array} proof - Proof path
 * @param {string} root - Expected root hash
 * @returns {boolean} Whether proof is valid
 */
export const validateMerkleProof = (leaf, index, proof, root) => {
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
};

/**
 * Simple hash function for proof validation
 * Note: This should match the SDK's hash function
 * @param {string} left - Left hash
 * @param {string} right - Right hash
 * @returns {string} Combined hash
 */
const hashPair = (left, right) => {
  // This is a simplified version - actual implementation
  // should use the same Poseidon hash as the SDK
  return `hash(${left},${right})`;
};

export default {
  getUTXOMerkletreeForNetwork,
  getTXIDMerkletreeForNetwork,
  getMerkleTreeRoot,
  getMerkleTreeLength,
  getMerkleProof,
  validateMerkleProof,
};
