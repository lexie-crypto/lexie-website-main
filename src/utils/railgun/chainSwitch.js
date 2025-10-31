/**
 * Chain Switch Utility
 * Centralized utility for handling Railgun chain switches
 *
 * Handles the complete chain switching flow:
 * 1. Check if chain is already scanned in Redis
 * 2. If not scanned, load wallet bootstrap data from Redis
 * 3. Await bootstrap completion
 * 4. Scan chain for balances
 * 5. Persist scan results to Redis
 *
 * Used by WalletContext after wagmi chain switch completes
 */

import { NetworkName } from '@railgun-community/shared-models';

/**
 * Main chain switch function - orchestrates the entire chain switching flow
 * @param {Object} params
 * @param {string} params.address - User's EOA address
 * @param {string} params.railgunWalletID - Railgun wallet ID
 * @param {number} params.targetChainId - Target chain ID to switch to
 * @param {Function} params.onProgress - Progress callback function
 * @param {Function} params.onError - Error callback function
 * @param {Function} params.onComplete - Completion callback function
 * @returns {Promise<boolean>} Success status
 */
export async function switchToChain({
  address,
  railgunWalletID,
  targetChainId,
  onProgress = () => {},
  onError = () => {},
  onComplete = () => {}
}) {
  try {
    console.log(`[ChainSwitch] Starting chain switch to ${targetChainId}`, {
      address: address?.slice(0, 8) + '...',
      walletId: railgunWalletID?.slice(0, 8) + '...'
    });

    onProgress({ phase: 'checking-scan-status', chainId: targetChainId });

    // Step 1: Check if chain is already scanned
    const scanStatus = await checkChainScanStatus(address, railgunWalletID, targetChainId);

    if (scanStatus.isScanned) {
      console.log(`[ChainSwitch] Chain ${targetChainId} already scanned, skipping switch process`);
      onComplete({ chainId: targetChainId, skipped: true });
      return true;
    }

    // Step 2: Load bootstrap data if available and wait for FULL hydration
    onProgress({ phase: 'loading-bootstrap', chainId: targetChainId });
    const bootstrapResult = await loadChainBootstrapIfAvailable(railgunWalletID, targetChainId, {
      address,
      onProgress: (progress) => onProgress({ phase: 'bootstrap-progress', progress, chainId: targetChainId })
    });

    // CRITICAL: Wait for hydration to be fully complete before scanning
    if (bootstrapResult.loaded) {
      console.log(`[ChainSwitch] Bootstrap loaded, ensuring hydration is fully complete before scanning...`);
      await waitForHydrationCompletion(railgunWalletID, targetChainId);
      console.log(`[ChainSwitch] ✅ Hydration fully complete, safe to scan chain ${targetChainId}`);
    }

    // Step 3: Scan chain for balances
    onProgress({ phase: 'scanning-chain', chainId: targetChainId });
    const scanResult = await scanChainForBalances(railgunWalletID, targetChainId);

    // Step 4: Mark as scanned in Redis
    onProgress({ phase: 'persisting-results', chainId: targetChainId });
    await persistScanResults(address, railgunWalletID, targetChainId);

    console.log(`[ChainSwitch] Chain switch to ${targetChainId} completed successfully`);

    // Dispatch final completion event for UI
    try {
      window.dispatchEvent(new CustomEvent('railgun-init-completed', {
        detail: { address, chainId: targetChainId }
      }));
    } catch (eventError) {
      console.warn('[ChainSwitch] Failed to dispatch completion event:', eventError);
    }

    onComplete({
      chainId: targetChainId,
      scanned: true,
      bootstrapLoaded: bootstrapResult.loaded
    });

    return true;

  } catch (error) {
    console.error(`[ChainSwitch] Chain switch to ${targetChainId} failed:`, error);
    onError({ chainId: targetChainId, error: error.message });
    return false;
  }
}

/**
 * Check if a chain has already been scanned for the given wallet
 * @param {string} address - User's EOA address
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {number} targetChainId - Chain ID to check
 * @returns {Promise<{isScanned: boolean, isHydrated: boolean}>}
 */
export async function checkChainScanStatus(address, railgunWalletID, targetChainId) {
  try {
    // Check Redis state via wallet metadata proxy
    const { checkChainHydratedInRedis, checkChainScannedInRedis } = await import('../sync/idb-sync/hydrationCheckUtils.js');

    const [hydratedCheck, scannedCheck] = await Promise.all([
      checkChainHydratedInRedis(address, railgunWalletID, targetChainId),
      checkChainScannedInRedis(address, railgunWalletID, targetChainId)
    ]);

    const isHydrated = hydratedCheck.isHydrated;
    const isScanned = scannedCheck.isScanned;

    // Also check in-memory flags
    const alreadyScannedInWindow = (typeof window !== 'undefined') &&
      window.__RAILGUN_INITIAL_SCAN_DONE &&
      window.__RAILGUN_INITIAL_SCAN_DONE[targetChainId];

    console.log(`[ChainSwitch] Scan status check for chain ${targetChainId}:`, {
      isHydrated,
      isScanned,
      alreadyScannedInWindow
    });

    return {
      isScanned: isScanned || alreadyScannedInWindow,
      isHydrated
    };

  } catch (error) {
    console.warn(`[ChainSwitch] Failed to check scan status for chain ${targetChainId}:`, error);
    return { isScanned: false, isHydrated: false };
  }
}

/**
 * Load chain bootstrap data if available
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {number} targetChainId - Chain ID to bootstrap
 * @param {Object} options
 * @param {string} options.address - User's EOA address
 * @param {Function} options.onProgress - Progress callback
 * @returns {Promise<{loaded: boolean, error?: string}>}
 */
export async function loadChainBootstrapIfAvailable(railgunWalletID, targetChainId, options = {}) {
  try {
    const { isMasterWallet } = await import('../sync/idb-sync/scheduler.js');
    const { isChainHydrating } = await import('../sync/idb-sync/hydration.js');

    // Only load bootstrap for regular wallets (not master wallets)
    if (isMasterWallet(railgunWalletID)) {
      console.log(`[ChainSwitch] Master wallet detected - skipping bootstrap for chain ${targetChainId}`);
      return { loaded: true, skipped: true };
    }

    // Check if chain is already hydrating
    if (isChainHydrating(railgunWalletID, targetChainId)) {
      console.log(`[ChainSwitch] Chain ${targetChainId} already hydrating, waiting...`);
      // Wait for existing hydration to complete
      await waitForHydrationCompletion(railgunWalletID, targetChainId);
      return { loaded: true, wasAlreadyHydrating: true };
    }

    // Check if bootstrap data is available
    const { checkChainBootstrapAvailable, loadChainBootstrap } = await import('../sync/idb-sync/hydration.js');
    const hasBootstrap = await checkChainBootstrapAvailable(targetChainId);

    if (!hasBootstrap) {
      console.log(`[ChainSwitch] No bootstrap data available for chain ${targetChainId}`);
      return { loaded: false, notAvailable: true };
    }

    console.log(`[ChainSwitch] Loading bootstrap data for chain ${targetChainId}...`);

    // Load the bootstrap data and wait for FULL hydration completion
    let bootstrapCompleted = false;

    await new Promise((resolve, reject) => {
      loadChainBootstrap(railgunWalletID, targetChainId, {
        address: options.address,
        onProgress: (progress) => {
          console.log(`[ChainSwitch] Bootstrap progress: ${progress}%`);

          try {
            // Primary event for progress bar (VaultDesktop chain-bootstrap handler)
            window.dispatchEvent(new CustomEvent('chain-bootstrap-progress', {
              detail: {
                chainId: targetChainId,
                progress: progress // Progress is already a percentage (0-100) from hydration system
              }
            }));

            // Legacy event for message updates (VaultDesktop init-progress handler)
            window.dispatchEvent(new CustomEvent('railgun-init-progress', {
              detail: {
                current: progress,
                total: 100,
                percent: progress,
                message: `Loading blockchain data for chain ${targetChainId}...`
              }
            }));
          } catch (eventError) {
            console.warn('[ChainSwitch] Failed to dispatch bootstrap progress event:', eventError);
          }

          options.onProgress?.(progress);
        },
        onComplete: () => {
          console.log(`[ChainSwitch] Bootstrap data loaded successfully for chain ${targetChainId}`);
          // Mark bootstrap as completed, but hydration may still be ongoing
          bootstrapCompleted = true;
        },
        onError: (error) => {
          console.warn(`[ChainSwitch] Bootstrap failed for chain ${targetChainId}:`, error.message);
          reject(error);
        }
      });
    });

    // WAIT FOR FULL HYDRATION TO COMPLETE BEFORE PROCEEDING
    if (!bootstrapCompleted) {
      console.log(`[ChainSwitch] ⏳ Bootstrap in progress for chain ${targetChainId}, waiting...`);
      // Bootstrap is still running, wait a bit more
      let waitAttempts = 0;
      while (!bootstrapCompleted && waitAttempts < 9000) { // Max 15 minutes (900 seconds)
        await new Promise(resolve => setTimeout(resolve, 100));
        waitAttempts++;
      }

      if (!bootstrapCompleted) {
        console.warn(`[ChainSwitch] ⚠️ Bootstrap timeout for chain ${targetChainId}, proceeding with scan anyway`);
      } else {
        console.log(`[ChainSwitch] ✅ Bootstrap confirmed complete for chain ${targetChainId}, safe to scan`);
      }
    }

    return { loaded: true };

  } catch (error) {
    console.warn(`[ChainSwitch] Bootstrap loading failed for chain ${targetChainId}:`, error);
    return { loaded: false, error: error.message };
  }
}

/**
 * Wait for an ongoing hydration process to complete
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {number} targetChainId - Chain ID being hydrated
 * @returns {Promise<void>}
 */
async function waitForHydrationCompletion(railgunWalletID, targetChainId) {
  const { isChainHydrating } = await import('../sync/idb-sync/hydration.js');

  const maxWaitTime = 900000; // 15 minutes
  const checkInterval = 1000; // Check every second
  let waited = 0;

  while (waited < maxWaitTime) {
    if (!isChainHydrating(railgunWalletID, targetChainId)) {
      console.log(`[ChainSwitch] Hydration completed for chain ${targetChainId}`);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
    waited += checkInterval;
  }

  throw new Error(`Hydration timeout for chain ${targetChainId}`);
}

/**
 * Scan a chain for Railgun wallet balances
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {number} targetChainId - Chain ID to scan
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function scanChainForBalances(railgunWalletID, targetChainId) {
  try {
    // Resolve Railgun chain config
    const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
    let railgunChain = null;
    for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
      if (cfg.chain.id === targetChainId) {
        railgunChain = cfg.chain;
        break;
      }
    }

    if (!railgunChain) {
      throw new Error(`No Railgun chain config found for chainId: ${targetChainId}`);
    }

    console.log(`[ChainSwitch] Starting balance refresh for chain ${targetChainId}...`);

    // Dispatch initial scanning progress event
    try {
      window.dispatchEvent(new CustomEvent('railgun-init-progress', {
        detail: {
          current: 0,
          total: 100,
          percent: 0,
          message: `Scanning blockchain for balances on chain ${targetChainId}...`
        }
      }));
    } catch (eventError) {
      console.warn('[ChainSwitch] Failed to dispatch scanning progress event:', eventError);
    }

    // Call SDK to refresh balances
    const { refreshBalances } = await import('@railgun-community/wallet');

    // Wrap the balance refresh to provide progress updates
    const balanceRefreshPromise = refreshBalances(railgunChain, [railgunWalletID]);

    // Simulate progress during scanning (SDK doesn't provide progress callbacks)
    const progressInterval = setInterval(() => {
      try {
        window.dispatchEvent(new CustomEvent('railgun-init-progress', {
          detail: {
            current: Math.min(90, Math.random() * 50 + 10), // Random progress between 10-90%
            total: 100,
            percent: Math.min(90, Math.random() * 50 + 10),
            message: `Scanning blockchain for balances on chain ${targetChainId}...`
          }
        }));
      } catch (eventError) {
        console.warn('[ChainSwitch] Failed to dispatch scanning progress update:', eventError);
      }
    }, 1000);

    try {
      await balanceRefreshPromise;

      // Dispatch completion progress event
      try {
        window.dispatchEvent(new CustomEvent('railgun-init-progress', {
          detail: {
            current: 100,
            total: 100,
            percent: 100,
            message: `Balance scan completed for chain ${targetChainId}`
          }
        }));
      } catch (eventError) {
        console.warn('[ChainSwitch] Failed to dispatch scan completion event:', eventError);
      }

    } finally {
      clearInterval(progressInterval);
    }

    // Mark as scanned in memory
    if (typeof window !== 'undefined') {
      window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
      window.__RAILGUN_INITIAL_SCAN_DONE[targetChainId] = true;
    }

    console.log(`[ChainSwitch] Balance refresh completed for chain ${targetChainId}`);
    return { success: true };

  } catch (error) {
    console.error(`[ChainSwitch] Balance refresh failed for chain ${targetChainId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Persist scan results to Redis metadata
 * @param {string} address - User's EOA address
 * @param {string} railgunWalletID - Railgun wallet ID
 * @param {number} targetChainId - Chain ID that was scanned
 * @returns {Promise<boolean>} Success status
 */
export async function persistScanResults(address, railgunWalletID, targetChainId) {
  try {
    console.log(`[ChainSwitch] Persisting scan results for chain ${targetChainId}...`);

    // Fetch existing metadata to preserve fields
    const getResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
    let existing = {};
    if (getResp.ok) {
      const data = await getResp.json();
      const metaKey = data?.keys?.find((k) => k.walletId === railgunWalletID);
      if (metaKey) {
        existing = {
          railgunAddress: metaKey.railgunAddress,
          signature: metaKey.signature,
          encryptedMnemonic: metaKey.encryptedMnemonic,
          privateBalances: metaKey.privateBalances,
          scannedChains: Array.from(new Set([...(metaKey.scannedChains || []), targetChainId]))
        };
      }
    }

    // Post updated metadata
    const persistResp = await fetch('/api/wallet-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: address,
        walletId: railgunWalletID,
        ...existing,
        scannedChains: Array.from(new Set([...(existing.scannedChains || []), targetChainId]))
      })
    });

    if (persistResp.ok) {
      console.log(`[ChainSwitch] Successfully persisted scannedChains += ${targetChainId}`);

      // Notify UI to re-check readiness
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('railgun-scan-complete', { detail: { chainId: targetChainId } }));
      }

      return true;
    } else {
      console.warn(`[ChainSwitch] Failed to persist scannedChains += ${targetChainId}:`, await persistResp.text());
      return false;
    }

  } catch (error) {
    console.warn(`[ChainSwitch] Error persisting scan results for chain ${targetChainId}:`, error);
    return false;
  }
}

/**
 * Check if a chain switch is currently in progress
 * @param {number} chainId - Chain ID to check
 * @returns {boolean}
 */
export function isChainSwitchInProgress(chainId) {
  if (typeof window === 'undefined') return false;

  // Check global flags
  return !!(window.__RAILGUN_SCANNING_IN_PROGRESS || window.__RAILGUN_TRANSACTION_IN_PROGRESS);
}

/**
 * Get the current chain switch status
 * @returns {Object} Status information
 */
export function getChainSwitchStatus() {
  return {
    isScanning: typeof window !== 'undefined' && window.__RAILGUN_SCANNING_IN_PROGRESS,
    isTransacting: typeof window !== 'undefined' && window.__RAILGUN_TRANSACTION_IN_PROGRESS,
    scannedChains: typeof window !== 'undefined' ? window.__RAILGUN_INITIAL_SCAN_DONE : {}
  };
}
