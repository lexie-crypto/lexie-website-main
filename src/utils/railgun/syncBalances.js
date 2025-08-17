/**
 * Centralized SDK refresh → persist-to-Redis utility.
 * - Triggers Railgun SDK refreshBalances for a specific wallet/chain
 * - Waits for a Spendable balance callback for the wallet
 * - Converts callback balances to our storage format
 * - Writes to Redis via /api/wallet-metadata POST (store-wallet-metadata)
 */

import { waitForRailgunReady } from './engine.js';

const waitForBalanceUpdate = (walletId, targetChainId, timeoutMs = 30000) => {
  return new Promise((resolve) => {
    let lastEvent = null;
    const handler = (event) => {
      const ev = event.detail || {};
      if (ev.railgunWalletID !== walletId || ev.chain?.id !== targetChainId) return;
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

    const network = Object.values(NETWORK_CONFIG).find((c) => c.chain.id === chainId)?.chain;
    if (!network) throw new Error(`No network config for chain ${chainId}`);

    // Attach listener first; then trigger refresh
    const waitPromise = waitForBalanceUpdate(walletId, chainId, 45000);
    await refreshBalances(network, [walletId]);
    const balanceEvent = await waitPromise;
    if (!balanceEvent || !Array.isArray(balanceEvent.erc20Amounts)) return false;

    // Convert SDK tokens to our storage format
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

    // Persist to Redis via overwrite endpoint (authoritative)
    const response = await fetch('/api/wallet-metadata?action=overwrite-balances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress,
        walletId,
        chainId,
        balances: privateBalances,
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


