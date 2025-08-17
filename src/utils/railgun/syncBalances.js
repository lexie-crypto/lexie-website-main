/**
 * syncBalances.js
 * Single-purpose utility used by the Refresh button (and any caller) to:
 * 1) Trigger the official SDK balance refresh (same as post-shield)
 * 2) Wait for the Spendable balance callback for the specific wallet/chain
 * 3) Persist the new private balances to Redis via the store-wallet-metadata endpoint
 */

import { waitForRailgunReady } from './engine.js';

// Wait for the next Spendable balance update for this wallet + chain.
// Times out after timeoutMs and falls back to the latest balance update if available.
const waitForSpendableBalance = (walletId, chainId, timeoutMs = 45000) => {
  return new Promise((resolve) => {
    let lastEvent = null;
    const handler = (event) => {
      const ev = event.detail || {};
      if (ev.railgunWalletID !== walletId || ev.chain?.id !== chainId) return;
      lastEvent = ev;
      if (ev.balanceBucket === 'Spendable') {
        window.removeEventListener('railgun-balance-update', handler);
        resolve(ev);
      }
    };
    window.addEventListener('railgun-balance-update', handler);
    setTimeout(() => {
      window.removeEventListener('railgun-balance-update', handler);
      resolve(lastEvent);
    }, timeoutMs);
  });
};

export const refreshAndOverwriteBalances = async ({ walletAddress, walletId, chainId }) => {
  try {
    await waitForRailgunReady();

    const { refreshBalances } = await import('@railgun-community/wallet');
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const { getTokenDecimals, getTokenInfo } = await import('../../hooks/useBalances.js');

    const chain = Object.values(NETWORK_CONFIG).find((c) => c.chain.id === chainId)?.chain;
    if (!chain) throw new Error(`No network config for chain ${chainId}`);

    // Attach listener FIRST (post-shield pattern) so we can't miss the callback
    const spendablePromise = waitForSpendableBalance(walletId, chainId, 45000);

    // Trigger official SDK refresh (same API we use after shield)
    await refreshBalances(chain, [walletId]);

    // Wait for spendable callback (or latest fallback)
    const balanceEvent = await spendablePromise;
    if (!balanceEvent || !Array.isArray(balanceEvent.erc20Amounts)) {
      console.warn('[syncBalances] No balance callback received; aborting persist');
      return false;
    }

    // Convert callback amounts to our storage format
    const privateBalances = balanceEvent.erc20Amounts.map((t) => {
      const tokenAddress = String(t.tokenAddress || '').toLowerCase();
      const decimals = getTokenDecimals(tokenAddress, chainId) ?? 18;
      const tokenInfo = getTokenInfo(tokenAddress, chainId);
      const symbol = tokenInfo?.symbol || `TOKEN_${tokenAddress.slice(-6)}`;
      const numericBalance = Number((t.amount || '0')) / Math.pow(10, decimals);
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

    // Retrieve railgunAddress required by store-wallet-metadata
    let railgunAddress = null;
    try {
      const metaResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`);
      if (metaResp.ok) {
        const metaJson = await metaResp.json();
        const entry = metaJson?.keys?.find((k) => k.walletId === walletId);
        railgunAddress = entry?.railgunAddress || null;
      }
    } catch (_) {}
    // Persist: try store (requires railgunAddress), else fall back to overwrite-balances.
    let persisted = false;
    try {
      if (railgunAddress) {
        const resp = await fetch('/api/wallet-metadata', {
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
        if (resp.ok) {
          const json = await resp.json();
          if (json.success) persisted = true;
        }
      }
      if (!persisted) {
        const ow = await fetch('/api/wallet-metadata?action=overwrite-balances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress,
            walletId,
            chainId,
            balances: privateBalances,
          }),
        });
        if (!ow.ok) throw new Error(`Overwrite persist failed: ${ow.status}`);
        const json = await ow.json();
        if (!json.success) throw new Error(`Overwrite persist error: ${json.error}`);
        persisted = true;
      }
    } catch (persistErr) {
      console.error('[syncBalances] Persist error:', persistErr);
      return false;
    }
    return persisted;
  } catch (e) {
    console.error('[syncBalances] Failed to refresh & persist balances:', e);
    return false;
  }
};

export default { refreshAndOverwriteBalances };

// Remove duplicate legacy section left from prior edits
