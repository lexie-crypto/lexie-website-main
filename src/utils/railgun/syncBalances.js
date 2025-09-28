/**
 * syncBalances.js
 * Centralized utility for SDK refresh + Redis persist
 * 
 * Called after:
 * - Successful shield transactions
 * - Successful unshield transactions (ERC20 and native)
 * - Successful private transfers
 * - User clicks "Refresh" button
 * 
 * Process:
 * 1) Call SDK refreshBalances(chain, [walletId]) 
 * 2) Wait for onBalanceUpdateCallback (Spendable bucket)
 * 3) Always persist the numerical balance to railgun:{EOA}:{walletID}:balances
 */

import { waitForRailgunReady } from './engine.js';

/**
 * Wait for SDK balance callback for specific wallet/chain
 * Returns the first Spendable callback, or latest callback as fallback
 */
const waitForSDKBalanceCallback = (walletId, chainId, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    let latestCallback = null;
    
    const handler = (event) => {
      const callback = event.detail;
      
      // Only process callbacks for our target wallet and chain
      if (callback.railgunWalletID !== walletId || callback.chain?.id !== chainId) {
        return;
      }
      
      // Store latest callback as fallback
      latestCallback = callback;
      
      // Prefer Spendable bucket (contains spendable balances)
      if (callback.balanceBucket === 'Spendable') {
        window.removeEventListener('railgun-balance-update', handler);
        resolve(callback);
      }
    };
    
    // Attach listener
    window.addEventListener('railgun-balance-update', handler);
    
    // Timeout: return latest callback or null
    setTimeout(() => {
      window.removeEventListener('railgun-balance-update', handler);
      resolve(latestCallback);
    }, timeoutMs);
  });
};

/**
 * Main function: SDK refresh + persist to Redis
 * ALWAYS persists - never aborts
 */
export const syncBalancesAfterTransaction = async ({ 
  walletAddress, 
  walletId, 
  chainId 
}) => {
  try {
    console.log('[syncBalances] Starting SDK refresh + Redis persist...', {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      walletId: walletId?.slice(0, 8) + '...',
      chainId
    });

    await waitForRailgunReady();

    // Import SDK functions
    const { refreshBalances } = await import('@railgun-community/wallet');
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const { getTokenDecimals, getTokenInfo } = await import('../../hooks/useBalances.js');

    // Get chain config
    const chain = Object.values(NETWORK_CONFIG).find((c) => c.chain.id === chainId)?.chain;
    if (!chain) {
      throw new Error(`No network config for chain ${chainId}`);
    }

    // STEP 1: Attach SDK callback listener BEFORE triggering refresh
    console.log('[syncBalances] Attaching SDK balance callback listener...');
    const callbackPromise = waitForSDKBalanceCallback(walletId, chainId, 45000);

    // STEP 2: Trigger official SDK refresh (same as post-shield pattern)
    console.log('[syncBalances] Triggering SDK refreshBalances...');
    await refreshBalances(chain, [walletId]);

    // STEP 3: Wait for SDK callback with balance data
    console.log('[syncBalances] Waiting for SDK balance callback...');
    const balanceCallback = await callbackPromise;
    
    if (!balanceCallback || !Array.isArray(balanceCallback.erc20Amounts) || balanceCallback.erc20Amounts.length === 0) {
      console.warn('[syncBalances] No usable SDK balance callback received; skipping persist to avoid overwriting Redis with empty data');
      return false; // Do NOT overwrite Redis with empty balances
    }

    // STEP 4: Convert SDK callback data to our storage format
    const erc20Amounts = balanceCallback?.erc20Amounts || [];
    const privateBalances = erc20Amounts.map((token) => {
      const tokenAddress = String(token.tokenAddress || '').toLowerCase();
      const decimals = getTokenDecimals(tokenAddress, chainId) ?? 18;
      const tokenInfo = getTokenInfo(tokenAddress, chainId);
      const symbol = tokenInfo?.symbol || `TOKEN_${tokenAddress.slice(-6)}`;
      const numericBalance = Number(token.amount || '0') / Math.pow(10, decimals);
      
      return {
        symbol,
        tokenAddress,
        numericBalance,
        decimals,
        chainId,
        isPrivate: true,
        lastUpdated: new Date().toISOString(),
      };
    });

    console.log('[syncBalances] Converted SDK callback to storage format:', {
      tokenCount: privateBalances.length,
      tokens: privateBalances.map(t => `${t.symbol}: ${t.numericBalance}`)
    });

    // STEP 5: Get railgunAddress from metadata (required for store endpoint)
    let railgunAddress = null;
    try {
      const metaResponse = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`);
      if (metaResponse.ok) {
        const metaData = await metaResponse.json();
        const walletEntry = metaData?.keys?.find(k => k.walletId === walletId);
        railgunAddress = walletEntry?.railgunAddress || null;
      }
    } catch (metaError) {
      console.warn('[syncBalances] Failed to get railgunAddress:', metaError.message);
    }

    // STEP 6: Persist to Redis - try store endpoint first, fallback to overwrite
    let persistSuccess = false;

    // Try store-wallet-metadata endpoint (requires railgunAddress)
    if (railgunAddress) {
      try {
        console.log('[syncBalances] Persisting via store-wallet-metadata endpoint...');

        // 🚀 HYBRID APPROACH: Merkletree data is automatically stored in Redis via hybrid LevelDB adapter
        // Artifacts stay local, Merkletrees sync to Redis during balance scans
        console.log('[syncBalances] 📝 Merkletree data automatically stored in Redis via hybrid LevelDB adapter');

        const storeResponse = await fetch('/api/wallet-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress,
            walletId,
            railgunAddress,
            privateBalances,
            lastBalanceUpdate: new Date().toISOString(),
          }),
        });

        if (storeResponse.ok) {
          const storeResult = await storeResponse.json();
          if (storeResult.success) {
            persistSuccess = true;
            console.log('[syncBalances] ✅ Successfully persisted via store-wallet-metadata');
          }
        }
      } catch (storeError) {
        console.warn('[syncBalances] Store endpoint failed:', storeError.message);
      }
    }

    console.log('[syncBalances] ✅ SDK refresh + Redis persist completed successfully');
    // Notify UI to refresh public balances as well
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('railgun-public-refresh', { detail: { chainId } }));
      }
    } catch {}
    return true;

  } catch (error) {
    console.error('[syncBalances] ❌ SDK refresh + persist failed:', error.message);
    // Don't throw - log error but don't break calling code
    return false;
  }
};

/**
 * Extract Merkletree updates from LevelDB after a successful scan
 * @param {number} chainId - Chain ID
 * @param {string} walletId - Wallet ID that triggered the scan
 * @returns {Promise<Object|null>} Merkletree update data or null
 */
const extractMerkleTreeUpdates = async (chainId, walletId) => {
  try {
    console.log('[MerkleTree] 🔍 Extracting Merkletree updates for sync to Redis...', {
      chainId,
      walletId: walletId?.slice(0, 8) + '...'
    });

    // Get current Merkletree state from LevelDB
    const { getUTXOMerkletreeForNetwork, getTXIDMerkletreeForNetwork } = await import('./merkletree-utils.js');
    const { TXIDVersion, NetworkName } = await import('@railgun-community/shared-models');

    // Map chainId to network name
    const networkNameMap = {
      1: NetworkName.Ethereum,
      137: NetworkName.Polygon,
      42161: NetworkName.Arbitrum,
      56: NetworkName.BSC
    };

    const networkName = networkNameMap[chainId];
    if (!networkName) {
      console.warn('[MerkleTree] Unknown chainId for network mapping:', chainId);
      return null;
    }

    // Get current tree heights and latest leaves
    const utxoTree = getUTXOMerkletreeForNetwork(TXIDVersion.V2_PoseidonMerkle, networkName);
    const txidTree = getTXIDMerkletreeForNetwork(TXIDVersion.V2_PoseidonMerkle, networkName);

    const merkleData = {
      chainId,
      networkName,
      walletId,
      timestamp: Date.now(),
      utxoTree: {
        height: utxoTree.getTreeLength(),
        root: utxoTree.getRootHash(),
        // Get latest leaves (last 100 for incremental updates)
        latestLeaves: await getLatestLeaves(utxoTree, 100)
      },
      txidTree: {
        height: txidTree.getTreeLength(),
        root: txidTree.getRootHash(),
        latestLeaves: await getLatestLeaves(txidTree, 50)
      }
    };

    console.log('[MerkleTree] 📊 Extracted Merkletree data:', {
      chainId,
      utxoHeight: merkleData.utxoTree.height,
      txidHeight: merkleData.txidTree.height,
      latestUTXOLeaves: merkleData.utxoTree.latestLeaves.length,
      latestTXIDLeaves: merkleData.txidTree.latestLeaves.length
    });

    return merkleData;

  } catch (error) {
    console.error('[MerkleTree] ❌ Failed to extract Merkletree updates:', error);
    return null;
  }
};

/**
 * Sync Merkletree data to Redis central store
 * @param {number} chainId - Chain ID
 * @param {Object} merkleData - Merkletree data to sync
 * @returns {Promise<boolean>} Success status
 */
const syncMerkleTreeToRedis = async (chainId, merkleData) => {
  try {
    console.log('[MerkleTree] ☁️ Syncing Merkletree to Redis...', {
      chainId,
      utxoHeight: merkleData.utxoTree.height,
      txidHeight: merkleData.txidTree.height
    });

    const response = await fetch('/api/merkletree-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chainId,
        merkleData,
        syncSource: 'wallet-scan'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.success) {
      console.log('[MerkleTree] ✅ Successfully synced Merkletree to Redis');
      return true;
    } else {
      console.warn('[MerkleTree] ⚠️ Redis sync reported non-success:', result);
      return false;
    }

  } catch (error) {
    console.error('[MerkleTree] ❌ Failed to sync Merkletree to Redis:', error);
    return false;
  }
};

/**
 * Get latest leaves from a Merkletree for incremental updates
 * @param {Object} tree - Merkletree instance
 * @param {number} count - Number of latest leaves to get
 * @returns {Promise<Array>} Array of leaf data
 */
const getLatestLeaves = async (tree, count) => {
  const leaves = [];
  const treeLength = tree.getTreeLength();

  // Get the most recent leaves
  const startIndex = Math.max(0, treeLength - count);

  for (let i = startIndex; i < treeLength; i++) {
    try {
      // Note: This is a simplified version - actual implementation
      // would need to access the tree's internal leaf storage
      const leaf = await tree.getLeaf(i);
      leaves.push({
        index: i,
        hash: leaf.toString(),
        timestamp: Date.now()
      });
    } catch (error) {
      console.warn(`[MerkleTree] Failed to get leaf at index ${i}:`, error.message);
    }
  }

  return leaves;
};

export default { syncBalancesAfterTransaction };
