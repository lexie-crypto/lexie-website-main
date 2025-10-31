/**
 * balanceRefresh.js
 * Centralized balance refresh utility
 *
 * Handles SDK refresh + Redis persist + UI updates
 * Prevents unplanned refreshes by isolating refresh logic
 */

import { syncBalancesAfterTransaction } from './railgun/syncBalances.js';
import { toast } from 'react-hot-toast';

/**
 * Full balance refresh: SDK refresh + Redis persist + UI update
 * @param {Object} params
 * @param {string} params.walletAddress - User's wallet address
 * @param {string} params.walletId - Railgun wallet ID
 * @param {number} params.chainId - Chain ID to refresh
 * @param {Function} params.refreshAllBalances - UI refresh function
 * @param {boolean} params.showToast - Whether to show success toast
 * @param {boolean} params.skipUIUpdate - Skip UI refresh and toast (for internal use)
 * @returns {Promise<boolean>} Success status
 */
export const refreshBalances = async ({
  walletAddress,
  walletId,
  chainId,
  refreshAllBalances,
  showToast = true,
  skipUIUpdate = false
}) => {
  try {
    // Dispatch start event for UI spinner (only if doing UI updates)
    if (!skipUIUpdate) {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-start')); } catch {}
    }

    console.log('[BalanceRefresh] Full refresh — SDK + Redis' + (skipUIUpdate ? '' : ' + UI') + '...');

    // Step 1: SDK refresh + persist to Redis
    console.log('[BalanceRefresh] Triggering SDK balance refresh...');
    let sdkSuccess = false;
    try {
      if (walletId && walletAddress && chainId) {
        sdkSuccess = await syncBalancesAfterTransaction({
          walletAddress,
          walletId,
          chainId,
        });
      }
    } catch (sdkErr) {
      console.warn('[BalanceRefresh] SDK refresh failed' + (skipUIUpdate ? '' : ' (continuing to UI)') + ':', sdkErr?.message);
    }

    // Step 2: Refresh UI from Redis/cache (skip if requested)
    if (!skipUIUpdate) {
      console.log('[BalanceRefresh] Refreshing UI balances...');
      await refreshAllBalances();
    }

    // Step 3: Show success toast if requested and not skipping UI updates
    if (showToast && sdkSuccess && !skipUIUpdate) {
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Balances refreshed</div>
                <div className="text-xs text-green-400/80">Public and vault balances updated</div>
              </div>
              <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80">×</button>
            </div>
          </div>
        </div>
      ), { duration: 2500 });
    }

    console.log('[BalanceRefresh] ✅ Full refresh completed');
    return true;

  } catch (error) {
    console.error('[BalanceRefresh] ❌ Refresh failed:', error);

    // Show error toast if requested and not skipping UI updates
    if (showToast && !skipUIUpdate) {
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-red-400" />
              <div>
                <div className="text-sm">Failed to refresh balances</div>
                <div className="text-xs text-green-400/80">Please try again</div>
              </div>
              <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80">×</button>
            </div>
          </div>
        </div>
      ), { duration: 3500 });
    }

    return false;
  } finally {
    // Dispatch complete event (only if doing UI updates)
    if (!skipUIUpdate) {
      try { window.dispatchEvent(new CustomEvent('vault-private-refresh-complete')); } catch {}
    }
  }
};

/**
 * Hook for balance refresh functionality
 * Provides stable refresh functions that don't cause unplanned re-renders
 */
export const useBalanceRefresh = ({ refreshAllBalances }) => {
  return {
    refreshBalances: async (walletAddress, walletId, chainId, showToast = true) => {
      return await refreshBalances({
        walletAddress,
        walletId,
        chainId,
        refreshAllBalances,
        showToast
      });
    }
  };
};

export default { refreshBalances, useBalanceRefresh };
