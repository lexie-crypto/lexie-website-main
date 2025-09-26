/**
 * Recipient Resolution Utilities
 * Handles ENS names, Lexie IDs, and address validation for RAILGUN transactions
 */

/**
 * Resolve recipient input into a valid 0x address.
 * - Accepts an ENS name, 0x address, or Lexie ID
 * - Uses provided wallet provider (if available) to resolve ENS
 * - Resolves Lexie IDs to Railgun addresses via backend API
 *
 * @param {string} recipientInput - The recipient input (ENS name, 0x address, or Lexie ID)
 * @param {Function} walletProvider - Optional wallet provider function for ENS resolution
 * @returns {string|null} Resolved 0x address or Railgun address, or null if resolution failed
 */
export const resolveRecipient = async (recipientInput, walletProvider) => {
  if (!recipientInput || typeof recipientInput !== 'string') return null;
  try {
    const { ethers } = await import('ethers');

    // Already a 0x address
    if (recipientInput.startsWith('0x') && ethers.isAddress(recipientInput)) {
      return recipientInput;
    }

    // Check if it's a Railgun address (0zk...)
    if (recipientInput.startsWith('0zk')) {
      console.log('🔎 [RESOLVE] Input is already a Railgun address:', recipientInput);
      return recipientInput;
    }

    const name = recipientInput.trim().toLowerCase();

    // Check if it's a Lexie ID (no @ prefix, alphanumeric)
    const lexieIdPattern = /^[a-zA-Z0-9_]{3,20}$/;
    if (lexieIdPattern.test(name)) {
      console.log('🔎 [RESOLVE] Attempting Lexie ID resolution:', name);
      try {
        // Call backend API to resolve Lexie ID to Railgun address
        const response = await fetch(`/api/wallet-metadata?action=lexie-resolve&lexieID=${encodeURIComponent(name)}`);
        const data = await response.json();

        if (data.success && data.walletAddress) {
          console.log('✅ [RESOLVE] Lexie ID resolved to Railgun address:', {
            lexieID: name,
            railgunAddress: data.walletAddress
          });
          return data.walletAddress;
        } else {
          console.warn('⚠️ [RESOLVE] Lexie ID not found or not linked:', name);
          // Continue to ENS resolution
        }
      } catch (lexieError) {
        console.warn('⚠️ [RESOLVE] Lexie ID resolution failed:', lexieError.message);
        // Continue to ENS resolution
      }
    }

    // Try ENS resolution via connected provider first
    try {
      const signer = typeof walletProvider === 'function' ? await walletProvider() : undefined;
      const provider = signer?.provider;
      if (provider && !name.startsWith('0x')) {
        const resolved = await provider.resolveName(name);
        if (resolved && ethers.isAddress(resolved)) {
          console.log('🔎 [UNSHIELD] ENS resolved via connected provider:', { name, resolved });
          return resolved;
        }
      }
    } catch (e) {
      // continue to fallback
    }

    // Fallback: resolve ENS on Ethereum mainnet via proxied Alchemy or default provider
    try {
      let mainnetProvider;
      try {
        // Use our proxied RPC to avoid exposing keys
        const { JsonRpcProvider } = ethers;
        const origin = (typeof window !== 'undefined' ? window.location.origin : '');
        mainnetProvider = new JsonRpcProvider(origin + '/api/rpc?chainId=1&provider=auto');
      } catch (_) {
        mainnetProvider = ethers.getDefaultProvider('mainnet');
      }

      const resolved = await mainnetProvider.resolveName(name);
      if (resolved && ethers.isAddress(resolved)) {
        console.log('🔎 [UNSHIELD] ENS resolved via proxied mainnet provider:', { name, resolved });
        return resolved;
      }
    } catch (e2) {
      // fall through to return null
    }
  } catch (err) {
    // Silent fallthrough; caller will validate null
  }
  return null;
};
