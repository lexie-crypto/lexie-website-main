/**
 * Hydration Check Utilities
 * Centralized logic for checking if chains are hydrated in Redis
 */

/**
 * Check if a specific chain is hydrated in Redis for a wallet
 * @param {string} address - EOA address
 * @param {string} walletId - Wallet ID
 * @param {number} chainId - Chain ID to check
 * @returns {Promise<{isHydrated: boolean, hydratedChains: number[], error: string|null}>}
 */
export const checkChainHydratedInRedis = async (address, walletId, chainId) => {
  try {
    console.log(`[Hydration-Check] Checking if chain ${chainId} is hydrated in Redis for wallet ${walletId}`);
    console.log(`[Hydration-Check] Expected Redis key format: railgun:${address}:${walletId}:meta`);

    const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);

    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      console.warn(`[Hydration-Check] Failed to fetch wallet metadata:`, error);
      return { isHydrated: false, hydratedChains: [], error };
    }

    const data = await response.json();
    console.log(`[Hydration-Check] Full API response:`, data);

    if (data.success && data.keys && data.keys.length > 0) {
      console.log(`[Hydration-Check] 🔍 Searching through ${data.keys.length} keys for wallet ${walletId} metadata key`);

      // 🎯 CRITICAL FIX: Look specifically for the meta key matching this walletId
      const metaKey = data.keys.find(key => {
        // Check if this is the correct meta key for this wallet
        const isMetaKey = key.key?.includes(':meta') || key.format === 'new-structure';
        const isCorrectWallet = key.walletId === walletId; // ✅ CRITICAL FIX

        const matches = isMetaKey && isCorrectWallet;
        console.log(`[Hydration-Check] 📋 Checking key: ${key.key || 'no-key'} | walletId: ${key.walletId?.slice(0,8)}... | format: ${key.format} | isMetaKey: ${isMetaKey} | isCorrectWallet: ${isCorrectWallet} | MATCH: ${matches}`);

        return matches;
      });

      if (metaKey) {
        console.log(`[Hydration-Check] Raw metaKey object:`, metaKey);

        const hydratedChains = metaKey.hydratedChains || [];

        // Log the actual Redis key being checked
        const redisKey = metaKey.key || `railgun:${address}:${walletId}:meta`;
        console.log(`[Hydration-Check] Found Redis key: ${redisKey}`);
        console.log(`[Hydration-Check] HydratedChains in Redis:`, hydratedChains);

        const normalizedHydratedChains = hydratedChains
          .map(n => (typeof n === 'string' && n?.startsWith?.('0x') ? parseInt(n, 16) : Number(n)))
          .filter(n => Number.isFinite(n));

        const isChainHydrated = normalizedHydratedChains.includes(Number(chainId));

        console.log(`[Hydration-Check] Chain ${chainId} hydrated status:`, isChainHydrated);

        return {
          isHydrated: isChainHydrated,
          hydratedChains: normalizedHydratedChains,
          error: null
        };
      } else {
        console.log(`[Hydration-Check] ❌ No metadata key found for wallet ${walletId} (checked ${data.keys.length} keys)`);
        // Log what keys were found for debugging
        console.log(`[Hydration-Check] Available keys:`, data.keys.map(k => ({
          key: k.key,
          walletId: k.walletId,
          format: k.format,
          hasHydratedChains: !!k.hydratedChains
        })));
        return { isHydrated: false, hydratedChains: [], error: null };
      }
    } else {
      console.log(`[Hydration-Check] No wallet metadata found for address ${address}`);
      return { isHydrated: false, hydratedChains: [], error: null };
    }

  } catch (error) {
    console.warn(`[Hydration-Check] Failed to check Redis hydration status:`, error.message);
    return { isHydrated: false, hydratedChains: [], error: error.message };
  }
};

/**
 * Check if a specific chain is scanned in Redis for a wallet
 * @param {string} address - EOA address
 * @param {string} walletId - Wallet ID
 * @param {number} chainId - Chain ID to check
 * @returns {Promise<{isScanned: boolean, scannedChains: number[], error: string|null}>}
 */
export const checkChainScannedInRedis = async (address, walletId, chainId) => {
  try {
    console.log(`[Scan-Check] Checking if chain ${chainId} is scanned in Redis for wallet ${walletId}`);
    console.log(`[Scan-Check] Expected Redis key format: railgun:${address}:${walletId}:meta`);

    const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);

    if (!response.ok) {
      const error = `HTTP ${response.status}: ${response.statusText}`;
      console.warn(`[Scan-Check] Failed to fetch wallet metadata:`, error);
      return { isScanned: false, scannedChains: [], error };
    }

    const data = await response.json();
    console.log(`[Scan-Check] Full API response:`, data);

    if (data.success && data.keys && data.keys.length > 0) {
      console.log(`[Scan-Check] 🔍 Searching through ${data.keys.length} keys for wallet ${walletId} metadata key`);

      // 🎯 CRITICAL FIX: Look specifically for the meta key matching this walletId
      const metaKey = data.keys.find(key => {
        // Check if this is the correct meta key for this wallet
        const isMetaKey = key.key?.includes(':meta') || key.format === 'new-structure';
        const isCorrectWallet = key.walletId === walletId; // ✅ CRITICAL FIX

        const matches = isMetaKey && isCorrectWallet;
        console.log(`[Scan-Check] 📋 Checking key: ${key.key || 'no-key'} | walletId: ${key.walletId?.slice(0,8)}... | format: ${key.format} | isMetaKey: ${isMetaKey} | isCorrectWallet: ${isCorrectWallet} | MATCH: ${matches}`);

        return matches;
      });

      if (metaKey) {
        console.log(`[Scan-Check] Raw metaKey object:`, metaKey);

        const scannedChains = metaKey.scannedChains || [];

        // Log the actual Redis key being checked
        const redisKey = metaKey.key || `railgun:${address}:${walletId}:meta`;
        console.log(`[Scan-Check] Found Redis key: ${redisKey}`);
        console.log(`[Scan-Check] ScannedChains in Redis:`, scannedChains);

        const normalizedScannedChains = scannedChains
          .map(n => (typeof n === 'string' && n?.startsWith?.('0x') ? parseInt(n, 16) : Number(n)))
          .filter(n => Number.isFinite(n));

        const isChainScanned = normalizedScannedChains.includes(Number(chainId));

        console.log(`[Scan-Check] Chain ${chainId} scanned status:`, isChainScanned);

        return {
          isScanned: isChainScanned,
          scannedChains: normalizedScannedChains,
          error: null
        };
      } else {
        console.log(`[Scan-Check] ❌ No metadata key found for wallet ${walletId} (checked ${data.keys.length} keys)`);
        // Log what keys were found for debugging
        console.log(`[Scan-Check] Available keys:`, data.keys.map(k => ({
          key: k.key,
          walletId: k.walletId,
          format: k.format,
          hasScannedChains: !!k.scannedChains
        })));
        return { isScanned: false, scannedChains: [], error: null };
      }
    } else {
      console.log(`[Scan-Check] No wallet metadata found for address ${address}`);
      return { isScanned: false, scannedChains: [], error: null };
    }

  } catch (error) {
    console.warn(`[Scan-Check] Failed to check Redis scan status:`, error.message);
    return { isScanned: false, scannedChains: [], error: error.message };
  }
};
