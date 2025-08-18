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
 * Wait for SDK balance callback for specific wallet/chain.
 * Mirrors the resilient logic used in transactionMonitor QuickSync:
 * - Resolves on any balance update event for the target wallet/chain
 * - Tracks the latest callback as fallback
 * - Times out but still resolves with latest callback (does not reject)
 */
const waitForSDKBalanceCallback = (walletId, chainId, timeoutMs = 60000) => {
  return new Promise((resolve) => {
    let latestCallback = null;

    const handler = (event) => {
      const callback = event.detail;

      // Only process callbacks for our target wallet and chain
      if (callback.railgunWalletID !== walletId || callback.chain?.id !== chainId) {
        return;
      }

      // Track latest callback for fallback usage
      latestCallback = callback;

      // Resolve immediately on any balance update for this wallet/chain
      window.removeEventListener('railgun-balance-update', handler);
      resolve(callback);
    };

    // Attach listener
    window.addEventListener('railgun-balance-update', handler);

    // Timeout: resolve with latest callback (may be null)
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
    const callbackPromise = waitForSDKBalanceCallback(walletId, chainId, 60000);

    // STEP 2: Trigger official SDK refresh (same as post-shield pattern)
    console.log('[syncBalances] Triggering SDK refreshBalances...');
    await refreshBalances(chain, [walletId]);

    // STEP 3: Wait for SDK callback with balance data
    console.log('[syncBalances] Waiting for SDK balance callback...');
    const balanceCallback = await callbackPromise;
    
    if (!balanceCallback) {
      console.warn('[syncBalances] No SDK balance callback received within timeout; proceeding cautiously');
    }

    // STEP 4: Convert SDK callback data to our storage format
    const erc20Amounts = balanceCallback?.erc20Amounts || [];
    const privateBalances = erc20Amounts
      .filter((t) => t && t.tokenAddress)
      .map((token) => {
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

    if (!privateBalances.length) {
      console.warn('[syncBalances] SDK callback contained no ERC20 amounts; not overwriting Redis with empty balances');
      return false;
    }

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
        } else {
          console.warn('[syncBalances] Store endpoint HTTP error:', storeResponse.status);
        }
      } catch (storeError) {
        console.warn('[syncBalances] Store endpoint failed:', storeError.message);
      }
    }

    // Fallback to store-balances endpoint if needed
    if (!persistSuccess) {
      try {
        console.log('[syncBalances] Persisting via store-balances fallback endpoint...');
        const overwriteResponse = await fetch('/api/wallet-metadata?action=store-balances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress,
            walletId,
            chainId,
            balances: privateBalances,
          }),
        });

        if (!overwriteResponse.ok) {
          throw new Error(`Fallback HTTP ${overwriteResponse.status}`);
        }
        const overwriteResult = await overwriteResponse.json();
        if (!overwriteResult?.success) {
          throw new Error(`Fallback JSON error: ${overwriteResult?.error || 'unknown'}`);
        }
        persistSuccess = true;
        console.log('[syncBalances] ✅ Successfully persisted via store-balances');
      } catch (fallbackErr) {
        console.error('[syncBalances] ❌ Fallback persistence failed:', fallbackErr.message);
      }
    }

    if (!persistSuccess) {
      console.warn('[syncBalances] ⚠️ Persistence did not succeed; not overwriting Redis');
      return false;
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

export default { syncBalancesAfterTransaction };
