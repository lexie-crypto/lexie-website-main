/**
 * Centralized SDK refresh → persist-to-Redis utility.
 * - Triggers Railgun SDK refreshBalances for a specific wallet/chain
 * - Waits for a Spendable balance callback for the wallet
 * - Converts callback balances to our storage format
 * - Writes to Redis via /api/wallet-metadata POST (store-wallet-metadata)
 */

import { waitForRailgunReady } from './engine.js';

const waitForSpendableUpdate = (walletId, targetChainId, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const handler = (event) => {
      const ev = event.detail || {};
      if (ev.railgunWalletID === walletId && ev.chain?.id === targetChainId && ev.balanceBucket === 'Spendable') {
        window.removeEventListener('railgun-balance-update', handler);
        resolve(ev);
      }
    };
    window.addEventListener('railgun-balance-update', handler);
    setTimeout(() => {
      window.removeEventListener('railgun-balance-update', handler);
      resolve(null);
    }, timeoutMs);
  });
};

export const refreshAndOverwriteBalances = async ({ walletAddress, walletId, chainId }) => {
  try {
    await waitForRailgunReady();
    const { refreshBalances } = await import('@railgun-community/wallet');
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    const { getTokenDecimals, getTokenInfo } = await import('../../hooks/useBalances.js');

    const network = Object.values(NETWORK_CONFIG).find((c) => c.chain.id === chainId)?.chain;
    if (!network) throw new Error(`No network config for chain ${chainId}`);

    // Trigger SDK refresh
    await refreshBalances(network, [walletId]);

    // Wait for spendable callback
    const spendableEvent = await waitForSpendableUpdate(walletId, chainId, 30000);
    if (!spendableEvent || !Array.isArray(spendableEvent.erc20Amounts)) {
      console.warn('[SyncBalances] No spendable callback received within timeout; skipping persist');
      return false;
    }

    // Convert SDK tokens to our storage format
    const privateBalances = spendableEvent.erc20Amounts.map((t) => {
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

    // Retrieve existing meta to include railgunAddress (required by backend)
    let railgunAddress = null;
    try {
      const metaResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(walletAddress)}`);
      if (metaResp.ok) {
        const metaJson = await metaResp.json();
        const entry = metaJson?.keys?.find((k) => k.walletId === walletId);
        railgunAddress = entry?.railgunAddress || null;
      }
    } catch (_) {}

    // Persist to Redis via metadata store endpoint (include railgunAddress when available)
    const response = await fetch('/api/wallet-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        walletId,
        ...(railgunAddress ? { railgunAddress } : {}),
        privateBalances,
        lastBalanceUpdate: new Date().toISOString(),
      }),
    });
    if (!response.ok) throw new Error(`Persist failed: ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error(`Persist error: ${json.error}`);
    return true;
  } catch (e) {
    console.error('[SyncBalances] Failed to refresh & persist balances:', e);
    return false;
  }
};

export default { refreshAndOverwriteBalances };


