/**
 * Centralized Modal Unlock Utility
 * Ensures modal only unlocks once per chain when scan completes
 */

// Track which chains have already been unlocked to prevent duplicate unlocks
const unlockedChains = new Set();
const unlockPromises = new Map(); // chainId -> Promise for pending unlocks

/**
 * Check if a chain has already been unlocked
 * @param {number} chainId - The chain ID
 * @returns {boolean} Whether the chain is already unlocked
 */
export const isChainUnlocked = (chainId) => {
  return unlockedChains.has(chainId);
};

/**
 * Mark a chain as unlocked (only once)
 * @param {number} chainId - The chain ID
 */
export const markChainUnlocked = (chainId) => {
  unlockedChains.add(chainId);
  console.log('[ModalUnlock] ✅ Marked chain as unlocked:', chainId);
};

/**
 * Reset unlock state for a chain (for testing or reset scenarios)
 * @param {number} chainId - The chain ID
 */
export const resetChainUnlock = (chainId) => {
  unlockedChains.delete(chainId);
  unlockPromises.delete(chainId);
  console.log('[ModalUnlock] 🔄 Reset unlock state for chain:', chainId);
};

/**
 * Reset all unlock states
 */
export const resetAllUnlocks = () => {
  unlockedChains.clear();
  unlockPromises.clear();
  console.log('[ModalUnlock] 🔄 Reset all unlock states');
};

/**
 * Attempt to unlock the modal for a chain (only once)
 * @param {number} chainId - The chain ID (optional - will get from context if not provided)
 * @param {string} reason - Reason for the unlock attempt (for logging)
 * @returns {boolean} Whether the unlock was performed (false if already unlocked)
 */
export const unlockModalOnce = (chainId, reason = 'scan complete') => {
  let originalChainId = chainId;

  // If chainId not provided, try to get it from current context
  if (chainId === undefined || chainId === null) {
    try {
      // Try to get from global context first (set by VaultDesktop)
      if (typeof window !== 'undefined' && window.__LEXIE_ACTIVE_CHAIN_ID) {
        chainId = window.__LEXIE_ACTIVE_CHAIN_ID;
        console.log('[ModalUnlock] 📍 Got chainId from global context:', chainId);
      } else {
        // Fallback to localStorage
        const storedChain = localStorage.getItem('lexie-selected-chain');
        if (storedChain) {
          chainId = parseInt(storedChain, 10);
          console.log('[ModalUnlock] 📍 Got chainId from localStorage:', chainId);
        }
      }
    } catch (error) {
      console.warn('[ModalUnlock] ⚠️ Could not get chainId:', error);
    }

    // Last resort fallback - assume BNB chain (56)
    if (chainId === undefined || chainId === null) {
      console.warn('[ModalUnlock] ⚠️ Using fallback chainId 56 (BNB)');
      chainId = 56;
    }
  }

  // Validate chainId
  if (typeof chainId !== 'number' || isNaN(chainId)) {
    console.error('[ModalUnlock] ❌ Invalid chainId:', chainId);
    return false;
  }

  // Check if already unlocked
  if (isChainUnlocked(chainId)) {
    console.log('[ModalUnlock] ⏭️ Skipping unlock - chain already unlocked:', {
      chainId,
      reason,
      unlockedChains: Array.from(unlockedChains)
    });
    return false;
  }

  // Check if unlock is already in progress
  if (unlockPromises.has(chainId)) {
    console.log('[ModalUnlock] ⏳ Unlock already in progress for chain:', chainId);
    return false;
  }

  console.log('[ModalUnlock] 🚪 Attempting modal unlock for chain:', {
    chainId,
    reason,
    totalUnlocked: unlockedChains.size
  });

  // Mark as unlocked immediately to prevent race conditions
  markChainUnlocked(chainId);

  // Dispatch the unlock event
  try {
    if (typeof window !== 'undefined') {
      // Dispatch the primary scan complete event
      window.dispatchEvent(new CustomEvent('railgun-scan-complete', {
        detail: { chainId }
      }));

      // Also dispatch the immediate unlock event
      window.dispatchEvent(new CustomEvent('vault-modal-unlock', {
        detail: { chainId }
      }));

      console.log('[ModalUnlock] ✅ Dispatched unlock events for chain:', chainId);
      return true;
    }
  } catch (error) {
    console.error('[ModalUnlock] ❌ Failed to dispatch unlock events:', error);
    // If dispatch failed, allow retry by unmarking
    unlockedChains.delete(chainId);
    return false;
  }

  return false;
};

/**
 * Force unlock a chain (ignores previous unlock state)
 * @param {number} chainId - The chain ID
 * @param {string} reason - Reason for force unlock
 * @returns {boolean} Whether the unlock was performed
 */
export const forceUnlockModal = (chainId, reason = 'force unlock') => {
  console.log('[ModalUnlock] ⚡ Force unlocking modal for chain:', { chainId, reason });

  // Always dispatch regardless of previous state
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('railgun-scan-complete', {
        detail: { chainId }
      }));

      window.dispatchEvent(new CustomEvent('vault-modal-unlock', {
        detail: { chainId }
      }));

      // Mark as unlocked
      markChainUnlocked(chainId);

      console.log('[ModalUnlock] ✅ Force unlock completed for chain:', chainId);
      return true;
    }
  } catch (error) {
    console.error('[ModalUnlock] ❌ Failed to force unlock:', error);
    return false;
  }

  return false;
};

/**
 * Get current unlock status for debugging
 * @returns {Object} Current unlock state
 */
export const getUnlockStatus = () => {
  return {
    unlockedChains: Array.from(unlockedChains),
    pendingUnlocks: Array.from(unlockPromises.keys()),
    totalUnlocked: unlockedChains.size
  };
};

// Export for use in other modules
export default {
  isChainUnlocked,
  markChainUnlocked,
  resetChainUnlock,
  resetAllUnlocks,
  unlockModalOnce,
  forceUnlockModal,
  getUnlockStatus
};
