/**
 * Wallet Metadata API Functions
 * Shared utilities for wallet metadata operations
 */

import { NetworkName } from '@railgun-community/shared-models';
import { RPC_URLS } from '../../config/environment';

/**
 * Get wallet metadata from Redis
 */
export async function getWalletMetadata(walletAddress) {
  console.log('🔍 [GET-WALLET-METADATA] Starting API call', {
    walletAddress: walletAddress,
    walletAddressPreview: walletAddress?.slice(0, 8) + '...',
    url: `/api/wallet-metadata?walletAddress=${walletAddress}`,
    timestamp: new Date().toISOString()
  });

  try {
    const response = await fetch(`/api/wallet-metadata?walletAddress=${walletAddress}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    // Parse Redis response: { success: true, walletAddress: "0x...", totalKeys: 1, keys: [...] }
    if (result.success && result.keys && result.keys.length > 0) {
      // NEW FORMAT: Look for the new structure with :meta and :balances keys first
      const metaKey = result.keys.find(keyObj => keyObj.format === 'new-structure');

      if (metaKey) {
        // NEW FORMAT: Use the parsed data from backend
        console.log('🔍 [GET-WALLET-METADATA] Found NEW format wallet data (v3.0+)', {
          walletId: metaKey.walletId?.slice(0, 8) + '...',
          hasRailgunAddress: !!metaKey.railgunAddress,
          hasSignature: !!metaKey.signature,
          hasEncryptedMnemonic: !!metaKey.hasEncryptedMnemonic,
          crossDeviceReady: metaKey.notesSupported,
          privateBalanceCount: metaKey.privateBalanceCount || 0,
          version: metaKey.version
        });

        return {
          walletId: metaKey.walletId,
          railgunAddress: metaKey.railgunAddress,
          signature: metaKey.signature,
          encryptedMnemonic: metaKey.encryptedMnemonic,
          version: metaKey.version,
          walletAddress: result.walletAddress,
          source: 'Redis',
          crossDeviceReady: metaKey.notesSupported && !!metaKey.signature && !!metaKey.encryptedMnemonic,
          totalKeys: result.totalKeys,
          allKeys: result.keys,
          privateBalances: metaKey.privateBalances || [],
          lastBalanceUpdate: metaKey.lastBalanceUpdate,
          scannedChains: metaKey.scannedChains || []
        };
      }

      // FALLBACK: Handle old format for backward compatibility
      const firstKey = result.keys[0];
      if (firstKey && firstKey.format !== 'new-structure') {
        console.log('🔍 [GET-WALLET-METADATA] Found legacy format wallet data', {
          format: firstKey.format,
          hasRailgunAddress: !!firstKey.railgunAddress,
          hasSignature: !!firstKey.signature,
          version: firstKey.version
        });

        return {
          walletId: firstKey.walletId,
          railgunAddress: firstKey.railgunAddress,
          signature: firstKey.signature,
          encryptedMnemonic: firstKey.encryptedMnemonic,
          version: firstKey.version || '1.0',
          walletAddress: result.walletAddress,
          source: 'Redis',
          crossDeviceReady: !!(firstKey.signature && firstKey.encryptedMnemonic),
          totalKeys: result.totalKeys,
          allKeys: result.keys,
          privateBalances: firstKey.privateBalances || [],
          lastBalanceUpdate: firstKey.lastBalanceUpdate,
          scannedChains: firstKey.scannedChains || []
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to get wallet metadata:', error);
    return null;
  }
}

/**
 * Store wallet metadata to Redis
 */
export async function storeWalletMetadata(walletAddress, walletId, railgunAddress, signature = null, encryptedMnemonic = null, creationBlockNumbers = null) {
  console.log('💾 [STORE-WALLET-METADATA] Starting API call - COMPLETE REDIS STORAGE', {
    walletAddress: walletAddress?.slice(0, 8) + '...',
    walletId: walletId?.slice(0, 8) + '...',
    railgunAddress: railgunAddress?.slice(0, 8) + '...',
    hasSignature: !!signature,
    hasEncryptedMnemonic: !!encryptedMnemonic,
    hasCreationBlockNumbers: !!creationBlockNumbers,
    signaturePreview: signature?.slice(0, 10) + '...' || 'none',
    storageType: 'Redis-only (no localStorage)'
  });

  try {
    const response = await fetch('/api/wallet-metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        walletAddress,
        walletId,
        railgunAddress,
        signature,
        encryptedMnemonic, // Store encrypted mnemonic in Redis for cross-device access
        creationBlockNumbers // Store creation block numbers for faster future wallet loads
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return true;
  } catch (error) {
    console.error('Failed to store wallet metadata:', error);
    return false;
  }
}

/**
 * Fetch current block numbers for all supported networks to speed up Railgun wallet creation
 * This prevents Railgun from scanning from block 0, dramatically improving initialization speed
 */
export async function fetchCurrentBlockNumbers() {
  console.log('🏗️ [BLOCK-FETCH] Fetching current block numbers for all networks...');

  const networkConfigs = [
    { name: NetworkName.Ethereum, rpcUrl: RPC_URLS.ethereum, chainId: 1 },
    { name: NetworkName.Polygon, rpcUrl: RPC_URLS.polygon, chainId: 137 },
    { name: NetworkName.Arbitrum, rpcUrl: RPC_URLS.arbitrum, chainId: 42161 },
    { name: NetworkName.BNBChain, rpcUrl: RPC_URLS.bsc, chainId: 56 },
  ];

  const blockNumbers = {};

  // Fetch block numbers in parallel for better performance
  const fetchPromises = networkConfigs.map(async (network) => {
    try {
      console.log(`🏗️ [BLOCK-FETCH] Fetching block number for ${network.name}...`);

      // Use the proxied RPC endpoint that handles API keys and fallbacks
      const proxyUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/api/rpc?chainId=${network.chainId}&provider=auto`
        : network.rpcUrl; // Fallback for server-side

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_blockNumber',
          params: []
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`RPC Error: ${result.error.message}`);
      }

      // Convert hex string to number
      const blockNumber = parseInt(result.result, 16);
      blockNumbers[network.name] = blockNumber;

      console.log(`✅ [BLOCK-FETCH] ${network.name}: block ${blockNumber}`);

    } catch (error) {
      console.warn(`⚠️ [BLOCK-FETCH] Failed to fetch block number for ${network.name}:`, error.message);
      // Don't set to undefined - let Railgun handle the fallback gracefully
      // The SDK will still work, just slower for this network
    }
  });

  await Promise.all(fetchPromises);

  console.log('✅ [BLOCK-FETCH] Block number fetching complete:', blockNumbers);
  return blockNumbers;
}
