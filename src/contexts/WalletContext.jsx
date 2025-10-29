/**
 * Wallet Context Provider - Official Railgun SDK Integration
 * Uses the official @railgun-community/wallet SDK with proper provider management
 * No custom connector hacks - just clean UI layer over official SDK
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createConfig, custom } from 'wagmi';
import { mainnet, polygon, arbitrum, bsc } from 'wagmi/chains';
import { metaMask, walletConnect, injected } from 'wagmi/connectors';
import { WagmiProvider, useAccount, useConnect, useDisconnect, useSwitchChain, useConnectorClient, getConnectorClient, useSignMessage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_URLS, WALLETCONNECT_CONFIG, RAILGUN_CONFIG } from '../config/environment';
import { NetworkName } from '@railgun-community/shared-models';
import { initializeSyncSystem } from '../utils/sync/idb-sync/index.js';
import { createWalletBackup } from '../utils/sync/idb-sync/backup.js';
import { clearLevelDB } from '../utils/sync/idb-sync/exporter.js';
import { initializeRailgunWallet } from '../utils/railgun/walletInitialization.js';

// Inline wallet metadata API functions
async function getWalletMetadata(walletAddress) {
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

async function storeWalletMetadata(walletAddress, walletId, railgunAddress, signature = null, encryptedMnemonic = null, creationBlockNumbers = null) {
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
async function fetchCurrentBlockNumbers() {
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

// Export functions for use in wallet initialization
export { fetchCurrentBlockNumbers, getWalletMetadata, storeWalletMetadata };

// Create a client for React Query
const queryClient = new QueryClient();

// Get selected chain from localStorage for WalletConnect config
const getSelectedChainForWalletConnect = () => {
  try {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lexie-selected-chain');
      const parsed = saved ? parseInt(saved, 10) : null;
      if (parsed && [1, 137, 42161, 56].includes(parsed)) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('[WalletContext] Failed to read selected chain from localStorage:', error);
  }
  return 1; // Default to Ethereum
};

const selectedChainId = getSelectedChainForWalletConnect();
const walletConnectChains = selectedChainId === 1 ? [mainnet] :
                           selectedChainId === 137 ? [polygon] :
                           selectedChainId === 42161 ? [arbitrum] :
                           selectedChainId === 56 ? [bsc] : [mainnet];

// Create wagmi config - MINIMAL, just for UI wallet connection
const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum, bsc],
  connectors: [
    injected({ shimDisconnect: true }),
    metaMask(),
    walletConnect({
      projectId: WALLETCONNECT_CONFIG.projectId,
      metadata: WALLETCONNECT_CONFIG.metadata,
      // Remove chains restriction to allow all supported chains like the old code
    }),
  ],
  transports: {
    [mainnet.id]: custom({
      async request({ method, params }) {
        const response = await fetch(RPC_URLS.ethereum, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
        });
        const { result, error } = await response.json();
        if (error) throw new Error(`RPC error: ${JSON.stringify(error)}`);
        return result;
      },
    }),
    [polygon.id]: custom({
      async request({ method, params }) {
        const response = await fetch(RPC_URLS.polygon, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
        });
        const { result, error } = await response.json();
        if (error) throw new Error(`RPC error: ${JSON.stringify(error)}`);
        return result;
      },
    }),
    [arbitrum.id]: custom({
      async request({ method, params }) {
        const response = await fetch(RPC_URLS.arbitrum, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
        });
        const { result, error } = await response.json();
        if (error) throw new Error(`RPC error: ${JSON.stringify(error)}`);
        return result;
      },
    }),
    [bsc.id]: custom({
      async request({ method, params }) {
        const response = await fetch(RPC_URLS.bsc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
        });
        const { result, error } = await response.json();
        if (error) throw new Error(`RPC error: ${JSON.stringify(error)}`);
        return result;
      },
    }),
  },
  // Prevent silent reconnection after disconnect; require explicit connect
  autoConnect: false,
});

const WalletContext = createContext({
  isConnected: false,
  address: null,
  chainId: null,
  isConnecting: false,
  connectWallet: () => {},
  disconnectWallet: () => {},
  switchChain: () => {},
  isRailgunInitialized: false,
  initializeRailgun: () => {},
  railgunAddress: null,
  railgunWalletID: null,
});

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};

const WalletContextProvider = ({ children }) => {
  // Basic wallet state
  const [isRailgunInitialized, setIsRailgunInitialized] = useState(false);
  const [railgunAddress, setRailgunAddress] = useState(null);
  const [railgunWalletID, setRailgunWalletID] = useState(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [railgunError, setRailgunError] = useState(null);
  const [shouldShowLexieIdModal, setShouldShowLexieIdModal] = useState(false);
  const [showLexieIdChoiceModal, setShowLexieIdChoiceModal] = useState(false);
  const [lexieIdChoicePromise, setLexieIdChoicePromise] = useState(null);
  const [lexieIdLinkPromise, setLexieIdLinkPromise] = useState(null);
  const [showSignatureConfirmation, setShowSignatureConfirmation] = useState(false);
  const [signatureConfirmationPromise, setSignatureConfirmationPromise] = useState(null);
  const [pendingSignatureMessage, setPendingSignatureMessage] = useState('');

  // Returning user chain selection modal
  const [showReturningUserChainModal, setShowReturningUserChainModal] = useState(false);
  const [returningUserChainPromise, setReturningUserChainPromise] = useState(null);

  // Wagmi hooks - ONLY for UI wallet connection
  const { address, isConnected, chainId, connector, status } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: connectorClient } = useConnectorClient();
  const { signMessageAsync } = useSignMessage();

  // Global RPC rate limiter to prevent excessive calls
  const rpcLimiter = useRef({
    totalAttempts: 0,
    maxTotalAttempts: 9, // 3 networks × 3 attempts each = 9 max
    isBlocked: false,
    blockedForSession: null // Track which wallet session caused the block
  });

  // Track chains currently undergoing an initial scan to prevent overlaps
  const chainsScanningRef = useRef(new Set());
  // Capture explicitly selected injected provider (e.g., Rabby/Trust) from UI
  const selectedInjectedProviderRef = useRef(null);
  const disconnectingRef = useRef(false);
  const lastInitializedAddressRef = useRef(null);

  // Track current chain in real-time (avoids closure issues)
  const chainIdRef = useRef(chainId);

  // Track target chain for signature confirmation
  const targetChainIdRef = useRef(null);

  // Update target chain ref when user selects chain in modal
  useEffect(() => {
    try {
      const selected = parseInt(localStorage.getItem('lexie-selected-chain'), 10);
      if (selected) {
        targetChainIdRef.current = selected;
      }
    } catch {}
  }, []);

  // Update chainId ref whenever chainId changes (avoids closure issues)
  useEffect(() => {
    chainIdRef.current = chainId;
  }, [chainId]);

  // Signature confirmation
  const requestSignatureConfirmation = useCallback((message) => {
    return new Promise((resolve) => {
      setPendingSignatureMessage(message);
      setShowSignatureConfirmation(true);
      setSignatureConfirmationPromise({ resolve });
    });
  }, []);

  const confirmSignature = useCallback(async () => {
    if (signatureConfirmationPromise) {
      const selectedChain = targetChainIdRef.current || parseInt(localStorage.getItem('lexie-selected-chain'), 10);

      if (selectedChain && selectedChain !== chainIdRef.current) {  // Use ref for initial check
        console.log(`[Signature Confirm] Waiting for chain switch: ${chainIdRef.current} → ${selectedChain}`);

        // Wait up to 10 seconds for chainId to update
        const startTime = Date.now();
        while (Date.now() - startTime < 10000) {
          if (chainIdRef.current === selectedChain) {  // ✅ Poll the ref, not the closure variable!
            console.log(`[Signature Confirm] ✅ Chain switched!`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (chainIdRef.current !== selectedChain) {  // Use ref for timeout check
          console.warn(`[Signature Confirm] ⚠️ Timeout, proceeding with chain ${chainIdRef.current}`);
        }
      }

      signatureConfirmationPromise.resolve(true);
      setSignatureConfirmationPromise(null);
      setShowSignatureConfirmation(false);
      setPendingSignatureMessage('');
    }
  }, [signatureConfirmationPromise]);  // Remove chainId from dependencies

  const cancelSignature = useCallback(() => {
    if (signatureConfirmationPromise) {
      signatureConfirmationPromise.resolve(false);
      setSignatureConfirmationPromise(null);
      setShowSignatureConfirmation(false);
      setPendingSignatureMessage('');
    }
  }, [signatureConfirmationPromise]);

  // Ensure initial full scan is completed for a given chain before user transacts
  const ensureChainScanned = useCallback(async (targetChainId) => {
    try {
      // 🛡️ CRITICAL: Don't run scans if returning user modal is open
      if (showReturningUserChainModal) {
        console.log('[Railgun Init] ⏸️ Waiting for returning user to select chain before scanning');
        return;
      }

      if (!isConnected || !address || !railgunWalletID) return;

      // Resolve Railgun chain config by chainId
      const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
      let railgunChain = null;
      for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
        if (cfg.chain.id === targetChainId) { railgunChain = cfg.chain; break; }
      }
      if (!railgunChain) {
        console.warn('[Railgun Init] ⚠️ No Railgun chain for chainId:', targetChainId);
        return;
      }

      // Check Redis state via wallet metadata proxy
      let alreadyScannedInRedis = false;
      let alreadyHydratedInRedis = false;
      try {
        const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
        if (resp.ok) {
          const json = await resp.json();
          const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
          const scannedChains = metaKey?.scannedChains || [];
          const hydratedChains = metaKey?.hydratedChains || [];
          alreadyScannedInRedis = scannedChains.includes(railgunChain.id);
          alreadyHydratedInRedis = hydratedChains.includes(railgunChain.id);
        }
      } catch {}

      const alreadyScannedInWindow = (typeof window !== 'undefined') && window.__RAILGUN_INITIAL_SCAN_DONE && window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id];
      const isAlreadyScanning = chainsScanningRef.current.has(railgunChain.id);

      if (alreadyHydratedInRedis || alreadyScannedInRedis || alreadyScannedInWindow) {
        console.log(`[Railgun Init] ⏭️ Chain already ${alreadyHydratedInRedis ? 'hydrated' : 'scanned'}, skipping:`, railgunChain.id);
        return;
      }
      if (isAlreadyScanning) {
        console.log('[Railgun Init] ⏳ Initial scan already in progress for chain:', railgunChain.id);
        return;
      }

      // Respect RPC limiter
      resetRPCLimiter();
      if (rpcLimiter.current.isBlocked) {
        console.warn('[Railgun Init] 🚫 RPC limited, skipping initial scan for chain:', railgunChain.id);
        return;
      }

      chainsScanningRef.current.add(railgunChain.id);
      console.log('[Railgun Init] 🔄 Preparing initial scan for chain', railgunChain.id);

      // FIRST: Load chain bootstrap data from Redis to seed local LevelDB (if available)
      let bootstrapCompleted = false;
      try {
        const { isMasterWallet } = await import('../utils/sync/idb-sync/scheduler.js');
        const { isChainHydrating } = await import('../utils/sync/idb-sync/hydration.js');

        if (!isMasterWallet(railgunWalletID)) {
          // Only load bootstrap for regular wallets (not master wallets)
          const isScanning = (typeof window !== 'undefined') &&
            (window.__RAILGUN_SCANNING_IN_PROGRESS || window.__RAILGUN_TRANSACTION_IN_PROGRESS);

          // Check hydration guard: hydratedChains + hydration lock
          const isHydrating = isChainHydrating(railgunWalletID, targetChainId);
          if (alreadyHydratedInRedis || isHydrating) {
            console.log(`[Railgun Init] ⏭️ Chain ${targetChainId} already ${alreadyHydratedInRedis ? 'hydrated' : 'hydrating'}, skipping bootstrap`);
            bootstrapCompleted = true; // Consider already hydrated as "completed"
          } else if (!isScanning) {
            console.log(`[Railgun Init] 🚀 Checking for chain ${railgunChain.id} bootstrap data...`);
            const { checkChainBootstrapAvailable, loadChainBootstrap } = await import('../utils/sync/idb-sync/hydration.js');

            const hasBootstrap = await checkChainBootstrapAvailable(targetChainId);
            if (hasBootstrap) {
              console.log(`[Railgun Init] 🚀 Loading chain ${railgunChain.id} bootstrap to seed LevelDB...`);

              // CRITICAL: Await the bootstrap completion before proceeding with scan
              await loadChainBootstrap(railgunWalletID, targetChainId, {
                address, // Pass EOA address for Redis scannedChains check
                onProgress: (progress) => {
                  console.log(`[Railgun Init] 🚀 Chain ${railgunChain.id} bootstrap progress: ${progress}%`);
                  try {
                    window.dispatchEvent(new CustomEvent('chain-bootstrap-progress', {
                      detail: { walletId: railgunWalletID, chainId: railgunChain.id, progress }
                    }));
                  } catch {}
                },
                onComplete: async () => {
                  console.log(`[Railgun Init] 🚀 Chain ${railgunChain.id} bootstrap loaded successfully`);
                  bootstrapCompleted = true;

                  // Mark chain as hydrated in Redis metadata since we loaded bootstrap data
                  // Note: scannedChains will only be marked when modal unlocks to prevent premature marking
                  try {
                    // First fetch existing metadata to get current hydratedChains
                    const getResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
                    let existingHydratedChains = [];

                    if (getResp.ok) {
                      const existingData = await getResp.json();
                      const metaKey = existingData?.keys?.find((k) => k.walletId === railgunWalletID);
                      if (metaKey?.hydratedChains) {
                        existingHydratedChains = Array.isArray(metaKey.hydratedChains)
                          ? metaKey.hydratedChains
                          : [];
                      }
                    }

                    // Merge with new chain (avoid duplicates)
                    const updatedHydratedChains = [...new Set([...existingHydratedChains, railgunChain.id])];

                    const resp = await fetch('/api/wallet-metadata?action=persist-metadata', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        walletAddress: address,
                        walletId: railgunWalletID,
                        railgunAddress: railgunAddress,
                        hydratedChains: updatedHydratedChains
                      })
                    });
                    if (resp.ok) {
                      console.log(`[Railgun Init] ✅ Marked hydratedChains += ${railgunChain.id} (merged with existing: ${existingHydratedChains.join(',')}) (scannedChains will be marked on modal unlock)`);
                    } else {
                      console.error(`[Railgun Init] ❌ Failed to mark hydratedChains += ${railgunChain.id}:`, await resp.text());
                    }
                  } catch (err) {
                    console.warn('[Railgun Init] Failed to update hydrated chains:', err);
                  }
                },
                onError: (error) => {
                  console.warn(`[Railgun Init] 🚀 Chain ${railgunChain.id} bootstrap failed:`, error.message);
                  bootstrapCompleted = true; // Even on error, consider bootstrap "done" so scan can proceed
                  // Continue with normal scan even if bootstrap fails
                }
              });

              console.log(`[Railgun Init] ✅ Bootstrap loading initiated for chain ${railgunChain.id}, waiting for completion...`);
            } else {
              console.log(`[Railgun Init] 🚀 No bootstrap data available for chain ${railgunChain.id}`);
              bootstrapCompleted = true; // No bootstrap needed
            }
          } else {
            console.log(`[Railgun Init] 🚀 Skipping chain bootstrap - wallet currently scanning/transacting`);
            bootstrapCompleted = true; // Skipping counts as completed
          }
        } else {
          console.log(`[Railgun Init] 👑 Master wallet detected - skipping bootstrap (master is data source)`);
          bootstrapCompleted = true; // Master wallets don't need bootstrap
        }
      } catch (bootstrapError) {
        console.warn('[Railgun Init] 🚀 Bootstrap loading failed:', bootstrapError.message);
        bootstrapCompleted = true; // On error, proceed with scan anyway
        // Continue with normal scan even if bootstrap fails
      }

      // WAIT FOR BOOTSTRAP TO COMPLETE BEFORE STARTING SCAN
      if (!bootstrapCompleted) {
        console.log(`[Railgun Init] ⏳ Bootstrap in progress for chain ${railgunChain.id}, waiting...`);
        // Bootstrap is still running, wait a bit more
        let waitAttempts = 0;
        while (!bootstrapCompleted && waitAttempts < 9000) { // Max 15 minutes (900 seconds)
          await new Promise(resolve => setTimeout(resolve, 100));
          waitAttempts++;
        }

        if (!bootstrapCompleted) {
          console.warn(`[Railgun Init] ⚠️ Bootstrap timeout for chain ${railgunChain.id}, proceeding with scan anyway`);
        } else {
          console.log(`[Railgun Init] ✅ Bootstrap confirmed complete for chain ${railgunChain.id}, starting scan`);
        }
      }

      // NOW SAFE TO START THE SCAN - Bootstrap is complete
      console.log('[Railgun Init] 🔄 Starting initial balance refresh for chain', railgunChain.id);
      const { refreshBalances } = await import('@railgun-community/wallet');
            await refreshBalances(railgunChain, [railgunWalletID]);

      // Mark as scanned in memory and Redis metadata
      if (typeof window !== 'undefined') {
        window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
        window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id] = true;
      }

      try {
        // Persist scanned chain to Redis by updating wallet metadata
        // Fetch existing metadata first to preserve fields
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
              scannedChains: Array.from(new Set([...(metaKey.scannedChains || []), railgunChain.id]))
            };
          }
        }

        // Post updated metadata back via existing endpoint
        const persistResp = await fetch('/api/wallet-metadata', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: address,
            walletId: railgunWalletID,
            ...existing,
            scannedChains: Array.from(new Set([...(existing.scannedChains || []), railgunChain.id]))
          })
        });
        if (persistResp.ok) {
          console.log('[Railgun Init] 💾 Persisted scannedChains to Redis:', {
            chainId: railgunChain.id,
            walletId: railgunWalletID?.slice(0,8) + '...'
          });
          // Notify UI to re-check readiness
          try {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('railgun-scan-complete', { detail: { chainId: railgunChain.id } }));
            }
          } catch {}
        } else {
          console.warn('[Railgun Init] ⚠️ Failed to persist scannedChains to Redis:', await persistResp.text());
        }
      } catch {}

      console.log('[Railgun Init] ✅ Initial scan complete for chain', railgunChain.id);
    } catch (error) {
      console.warn('[Railgun Init] ⚠️ Initial scan failed:', error?.message);
    } finally {
      try {
        const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
        const chainObj = Object.values(NETWORK_CONFIG).find(cfg => cfg.chain.id === targetChainId)?.chain;
        if (chainObj) chainsScanningRef.current.delete(chainObj.id);
      } catch {}
    }
  }, [isConnected, address, railgunWalletID, showReturningUserChainModal]);

  // Reset rate limiter only on wallet disconnect/connect
  const resetRPCLimiter = () => {
    // Only reset if this is a different wallet session or user disconnected
    const currentSession = isConnected ? address : null;
    
    if (!isConnected || rpcLimiter.current.blockedForSession !== currentSession) {
      if (rpcLimiter.current.isBlocked) {
        console.log('[RPC-Limiter] 🔄 Resetting rate limiter for new wallet session:', { 
          previousSession: rpcLimiter.current.blockedForSession,
          currentSession 
        });
      }
      
      rpcLimiter.current.totalAttempts = 0;
      rpcLimiter.current.isBlocked = false;
      rpcLimiter.current.blockedForSession = null;
    }
  };

  // Reset rate limiter when wallet disconnects
  useEffect(() => {
    if (!isConnected) {
      console.log('[RPC-Limiter] 🔄 Wallet disconnected - resetting rate limiter');
      rpcLimiter.current.totalAttempts = 0;
      rpcLimiter.current.isBlocked = false;
      rpcLimiter.current.blockedForSession = null;
    }
  }, [isConnected]);

  // Global fetch interceptor to block RPC calls when rate limited
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Store original fetch
      const originalFetch = window.fetch;
      
      // Intercept fetch calls
      window.fetch = async (...args) => {
        const [url, options] = args;
        
        // Check if this is an RPC call (Alchemy direct or proxied via /api/rpc)
        if (typeof url === 'string' && (url.includes('alchemy') || url.includes('/api/rpc'))) {
          resetRPCLimiter();
          
          if (rpcLimiter.current.isBlocked) {
            // Parse the request body to check the method
            let method = 'unknown';
            try {
              if (options?.body) {
                const body = JSON.parse(options.body);
                method = body.method || 'unknown';
              }
            } catch (e) {
              // Failed to parse body, use default blocking
            }
            
            // Block only balance/log polling methods that cause spam
            const blockedMethods = [
              'eth_getLogs',           // Balance polling
              'eth_getBalance',        // Balance checks
              'eth_call',              // Contract calls for balance checks
              'eth_getTransactionReceipt', // Transaction receipt polling
            ];
            
            // Allow essential methods for transactions
            const allowedMethods = [
              'eth_gasPrice',          // Gas price for transactions
              'eth_estimateGas',       // Gas estimation
              'eth_sendTransaction',   // Sending transactions  
              'eth_getTransactionCount', // Nonce
              'eth_chainId',           // Chain ID
              'eth_blockNumber',       // Current block
              'net_version',           // Network version
            ];
            
            if (blockedMethods.includes(method)) {
              console.warn(`[RPC-Interceptor] 🚫 Blocked ${method} call to:`, url);
              throw new Error(`RPC call blocked due to rate limiting: ${method}`);
            }
            
            if (allowedMethods.includes(method)) {
              console.log(`[RPC-Interceptor] ✅ Allowing essential ${method} call for transactions`);
              return originalFetch.apply(window, args);
            }
            
            // For unknown methods when blocked, log and allow (conservative approach)
            console.warn(`[RPC-Interceptor] ⚠️ Unknown method ${method} - allowing due to uncertainty`);
          }
        }
        
        return originalFetch.apply(window, args);
      };
      
      // Cleanup on unmount
      return () => {
        window.fetch = originalFetch;
      };
    }
  }, []);

  // RPC Retry wrapper with global rate limiting
  const withRPCRetryLimit = async (providerLoadFn, networkName, maxRetries = 3) => {
    resetRPCLimiter();
    
    // Check global rate limit first
    if (rpcLimiter.current.isBlocked) {
      console.warn(`[RPC-Limiter] 🚫 Global RPC limit reached. Blocked for this wallet session.`);
      throw new Error(`Global RPC rate limit exceeded. Blocked for this wallet session. Please disconnect and reconnect to reset.`);
    }
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Check if we've hit the global limit
      if (rpcLimiter.current.totalAttempts >= rpcLimiter.current.maxTotalAttempts) {
        console.error(`[RPC-Limiter] 🚫 Global RPC limit (${rpcLimiter.current.maxTotalAttempts}) reached. Blocking all further attempts for this session.`);
        rpcLimiter.current.isBlocked = true;
        rpcLimiter.current.blockedForSession = isConnected ? address : null;
        throw new Error(`Global RPC rate limit exceeded. Blocked for this wallet session. Please disconnect and reconnect to reset.`);
      }
      
      try {
        console.log(`[RPC-Retry] Attempt ${attempt}/${maxRetries} for ${networkName} (Global: ${rpcLimiter.current.totalAttempts + 1}/${rpcLimiter.current.maxTotalAttempts})`);
        
        // Increment global counter before attempt
        rpcLimiter.current.totalAttempts++;
        
        const result = await providerLoadFn();
        
        console.log(`[RPC-Retry] ✅ Success on attempt ${attempt} for ${networkName}`);
        return result;
        
      } catch (error) {
        lastError = error;
        console.warn(`[RPC-Retry] ❌ Attempt ${attempt}/${maxRetries} failed for ${networkName}:`, error.message);
        
        if (attempt === maxRetries) {
          console.error(`[RPC-Retry] 🚫 All ${maxRetries} attempts failed for ${networkName}.`);
          throw new Error(`Failed to load provider for ${networkName} after ${maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retry (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
        console.log(`[RPC-Retry] ⏳ Waiting ${delay}ms before retry ${attempt + 1} for ${networkName}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  };

  // Get wallet signer for SDK operations using actual connected wallet
  const getWalletSigner = async (overrideProvider) => {
    // Prefer explicit injected provider when provided
    let selectedProvider = overrideProvider || selectedInjectedProviderRef.current;
    if (!selectedProvider) {
      if (!connector) {
        throw new Error('No connector available');
      }
      selectedProvider = await connector.getProvider();
    }
    if (!selectedProvider) {
      throw new Error('Failed to get EIP-1193 provider');
    }

    const { BrowserProvider } = await import('ethers');
    const provider = new BrowserProvider(selectedProvider);
    const signer = await provider.getSigner();
    
    console.log('✅ Wallet signer created using actual EIP-1193 provider:', {
      connectorId: connector?.id,
      connectorName: connector?.name,
      address: await signer.getAddress(),
      providerType: selectedProvider.constructor?.name || 'EIP1193Provider'
    });
    return signer;
  };

  // Simple wallet connection - UI layer only
  const connectWallet = async (connectorType = 'metamask', options = {}) => {
    try {
      let targetConnector = null;

      // If UI passed a specific injected provider, capture it for signer preference
      if (connectorType === 'injected' && options?.provider) {
        selectedInjectedProviderRef.current = options.provider;
      } else {
        selectedInjectedProviderRef.current = null;
      }

      // Map well-known brands to dedicated connectors when available
      const brandName = (options?.name || '').toLowerCase();
      const providerObj = options?.provider || {};
      const isMetaMaskBrand = providerObj.isMetaMask || brandName.includes('metamask');

      if (connectorType === 'metamask' || isMetaMaskBrand) {
        targetConnector = connectors.find(c => c.id === 'metaMask');
        // explicit brand path uses official connector only
        selectedInjectedProviderRef.current = null;
      } else if (connectorType === 'walletconnect') {
        targetConnector = connectors.find(c => c.id === 'walletConnect');
      } else if (connectorType === 'injected') {
        if (options?.provider) {
          // Bind wagmi to the clicked provider through a minimal connector
          const { clickedInjectedConnector } = await import('../connectors/clickedInjected.js');
          const connector = clickedInjectedConnector(options.provider, options?.name);
          // Pre-connect unload to guarantee clean slate even if connect fails mid-way
          try {
            const { clearAllWallets } = await import('../utils/railgun/wallet');
            await clearAllWallets();
          } catch {}
          await connect({ connector });
          console.log('✅ Connected via clicked injected provider:', options?.name || 'Injected');
          // Belt-and-suspenders: ensure any stale Railgun SDK wallets are unloaded before hydration
          try {
            const { clearAllWallets } = await import('../utils/railgun/wallet');
            await clearAllWallets();
          } catch {}
          return;
        }
        // No provider supplied: fallback to generic injected connector
        targetConnector = connectors.find(c => c.id === 'injected');
      }
      
      if (targetConnector) {
        // Pre-connect unload to guarantee clean slate even if connect fails mid-way
        try {
          const { clearAllWallets } = await import('../utils/railgun/wallet');
          await clearAllWallets();
        } catch {}
        await connect({ connector: targetConnector });
        console.log('✅ Connected via wagmi:', targetConnector.id, options?.name || '');


        // Belt-and-suspenders: ensure any stale Railgun SDK wallets are unloaded before hydration
        try {
          const { clearAllWallets } = await import('../utils/railgun/wallet');
          await clearAllWallets();
        } catch {}
      }
    } catch (error) {
      console.error('❌ Wagmi connection failed:', error);
      throw error;
    }
  };

  const disconnectWallet = async () => {
    // Prevent multiple simultaneous disconnect attempts
    if (disconnectWallet.isDisconnecting) {
      console.log('🚫 [DISCONNECT] Disconnect already in progress, ignoring...');
      return;
    }
    disconnectWallet.isDisconnecting = true;
    disconnectingRef.current = true;

    try {
      // 1. Unload ALL Railgun SDK wallet state first
      try {
        console.log('🧹 [DISCONNECT] Clearing all Railgun wallet state...');
        const { clearAllWallets } = await import('../utils/railgun/wallet');
        await clearAllWallets();
        console.log('✅ [DISCONNECT] All Railgun wallets unloaded');
      } catch (error) {
        console.warn('⚠️ [DISCONNECT] Failed to clear Railgun wallets:', error);
      }

      // 2. Reset wallet-scoped UI/session flags to prevent stale gating on next connect
      try { if (typeof window !== 'undefined') {
        delete window.__LEXIE_INIT_POLL_ID;
        window.dispatchEvent(new CustomEvent('force-disconnect'));
        // Clear any init/scan flags used by UI gating
        window.dispatchEvent(new CustomEvent('railgun-init-failed', { detail: { error: 'User disconnect' } }));
      } } catch {}
      
      // 3. Immediate UI state reset for snappy UX
      setIsRailgunInitialized(false);
      setRailgunAddress(null);
      setRailgunWalletID(null);
      setRailgunError(null);
      setIsInitializing(false);
      selectedInjectedProviderRef.current = null;

      // Best-effort: pause Railgun polling quickly
      try {
        const railgunWallet = await import('@railgun-community/wallet');
        if (railgunWallet.pauseAllPollingProviders) {
          railgunWallet.pauseAllPollingProviders();
        }
      } catch {}

      // Try to disconnect from the provider directly (for injected wallets)
      try {
        if (selectedInjectedProviderRef.current?.disconnect) {
          console.log('[DISCONNECT] Calling provider.disconnect()');
          await selectedInjectedProviderRef.current.disconnect();
        } else if (selectedInjectedProviderRef.current && typeof window !== 'undefined') {
          // Try wallet_revokePermissions for some wallets
          try {
            await selectedInjectedProviderRef.current.request({
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }]
            });
            console.log('[DISCONNECT] Called wallet_revokePermissions');
          } catch (revokeError) {
            // wallet_revokePermissions not supported, that's fine
          }
        }
      } catch (providerDisconnectError) {
        console.warn('⚠️ [DISCONNECT] Error disconnecting from provider:', providerDisconnectError);
      }

      // Disconnect wallet (non-blocking UX)
      try {
        await disconnect();
      } catch (disconnectError) {
        console.warn('⚠️ [DISCONNECT] Error disconnecting wallet:', disconnectError);
      }

      // Light cleanup of storage and globals without heavy timers/reload
      try {
        if (typeof window !== 'undefined') {
          // Preserve access code authentication across disconnects
          const accessGranted = localStorage.getItem('app_access_granted');
          const accessCodeUsed = localStorage.getItem('access_code_used');

          try { localStorage.clear(); } catch {}

          // Restore access code authentication
          if (accessGranted) {
            try { localStorage.setItem('app_access_granted', accessGranted); } catch {}
          }
          if (accessCodeUsed) {
            try { localStorage.setItem('access_code_used', accessCodeUsed); } catch {}
          }

          try { sessionStorage.clear(); } catch {}
          delete window.__RAILGUN_INITIAL_SCAN_DONE;
          delete window.__LEXIE_ENGINE_READY;
          delete window.__LEXIE_SUPPRESS_RAILGUN_INIT;
          delete window.__RAILGUN_ENGINE_INITIALIZED;
          delete window.__RAILGUN_WALLET_READY;
          delete window.__LEXIE_RAILGUN_DEBUG__;
          window.dispatchEvent(new CustomEvent('force-disconnect'));
        }
      } catch {}

      // Clear wagmi/walletconnect stored connector keys so auto-connect will not trigger
      try {
        const lc = localStorage;
        if (lc) {
          try { lc.removeItem('wagmi.wallet'); } catch {}
          try { lc.removeItem('wagmi.store'); } catch {}
          try { lc.removeItem('walletconnect'); } catch {}
          try { lc.removeItem('WALLETCONNECT_DEEPLINK_CHOICE'); } catch {}
          const keys = Object.keys(lc);
          keys.forEach((k) => {
            if (k.startsWith('wc@') || k.startsWith('wc:') || k.toLowerCase().includes('walletconnect') || k.toLowerCase().includes('web3modal')) {
              try { lc.removeItem(k); } catch {}
            }
          });
        }
      } catch {}

      // Reset RPC limiter
      try { resetRPCLimiter(); } catch {}

      console.log('✅ [DISCONNECT] Fast disconnect complete (no reload)');
    } finally {
      disconnectingRef.current = false;
      disconnectWallet.isDisconnecting = false;
    }
  };

  // Official Railgun SDK Integration
  const initializeRailgun = async () => {
    await initializeRailgunWallet({
              address,
      chainId,
      signMessageAsync,
      requestSignatureConfirmation,
      setRailgunAddress,
      setRailgunWalletID,
      setIsInitializing,
      setRailgunError,
      setIsRailgunInitialized,
      setShouldShowLexieIdModal,
      setShowLexieIdChoiceModal,
      setLexieIdChoicePromise,
      setLexieIdLinkPromise,
      selectedInjectedProviderRef,
      connector,
      getWalletSigner,
      withRPCRetryLimit,
      rpcLimiter,
      resetRPCLimiter,
      ensureChainScanned,
      chainsScanningRef,
      lastInitializedAddressRef,
      targetChainIdRef,
      chainIdRef
    });
  };

  // Minimal engine bootstrap for client-only shielding (no wallet creation/signature)
  const ensureEngineForShield = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window.__LEXIE_ENGINE_READY) {
        return true;
      }

      console.log('[Railgun Engine] 🔧 Initializing via engine.js (patched config, no wallet init)...');
      const { initializeRailgun } = await import('../utils/railgun/engine.js');
      await initializeRailgun();
      if (typeof window !== 'undefined') window.__LEXIE_ENGINE_READY = true;
      console.log('[Railgun Engine] ✅ Engine ready (engine.js)');
      return true;
    } catch (err) {
      console.error('[Railgun Engine] ❌ Light engine start failed:', err);
      return false;
    }
  }, [chainId]);

  // Auto-initialize Railgun when wallet connects (only if not already initialized)
  useEffect(() => {
    // 🛡️ CRITICAL: Don't auto-initialize if returning user modal is open
    if (showReturningUserChainModal) {
      console.log('[Railgun Init] ⏸️ Waiting for returning user to select chain before auto-initializing');
      return;
    }

    // 🛡️ Prevent force reinitialization if already initialized
    if (isRailgunInitialized) {
      console.log('✅ Railgun already initialized for:', address);

      // 🎯 FIXED: Don't auto-resume polling - let useBalances hook control when to poll
      console.log('⏸️ Providers remain paused - will resume only when balance refresh needed');
      return;
    }
    
    // Respect suppression flag (PaymentPage and other pages that don't need wallet creation)
    if (typeof window !== 'undefined' && (window.__LEXIE_SUPPRESS_RAILGUN_INIT || window.__LEXIE_PAYMENT_PAGE)) {
      console.log('[Railgun Init] ⏭️ Suppressed auto-init due to page flag (__LEXIE_SUPPRESS_RAILGUN_INIT or __LEXIE_PAYMENT_PAGE)');
      return;
    }

    // Bail if currently disconnecting to avoid race with stale wagmi state
    if (disconnectingRef.current) {
      console.log('[Railgun Init] ⏳ Skipping auto-init: disconnect in progress');
      return;
    }

    // Require wagmi status to be fully connected, not just isConnected
    if (status !== 'connected') {
      return;
    }

    // Prevent same-address re-init immediately after disconnect; require explicit reconnect
    if (lastInitializedAddressRef.current && lastInitializedAddressRef.current === address) {
      console.log('[Railgun Init] ⏭️ Skipping auto-init for same address until explicit reconnect');
      return;
    }

    if (isConnected && address && !isInitializing) {
      // Final safety check: ensure we have a valid supported chainId before initializing Railgun
      if (!chainId || chainId === 'NaN' || isNaN(chainId)) {
        console.log('⏳ [Railgun Init] Chain ID not yet available, deferring initialization...');
        return;
      }

      const supportedNetworks = { 1: true, 137: true, 42161: true, 56: true };
      if (!supportedNetworks[chainId]) {
        console.log(`🚫 [Railgun Init] Refusing to initialize on unsupported network (chainId: ${chainId})`);
        return;
      }

      console.log('🚀 Auto-initializing Railgun for connected wallet:', address);
      lastInitializedAddressRef.current = address;
      initializeRailgun().then(() => {
        // 🚀 BOOTSTRAP: After Railgun init, check if we need to load chain bootstrap
        setTimeout(async () => {
          try {
            if (railgunWalletID) {
              console.log('🚀 Checking chain bootstrap after auto-init...');
              const { checkChainBootstrapAvailable, loadChainBootstrap, isChainHydrating } = await import('../utils/sync/idb-sync/hydration.js');
              const { isMasterWallet } = await import('../utils/sync/idb-sync/scheduler.js');

              // Only load bootstrap for regular wallets
              if (!isMasterWallet(railgunWalletID)) {
                // ✅ FIX: Check if chain is already SCANNED first (not just hydrated)
                let alreadyScanned = false;
                try {
                  const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
                  if (resp.ok) {
                    const json = await resp.json();
                    const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
                    const scannedChains = metaKey?.scannedChains || [];
                    alreadyScanned = scannedChains.includes(chainId);
                  }
                } catch {}

                // If already scanned, skip bootstrap entirely (bootstrap is only for initial scan speedup)
                if (alreadyScanned) {
                  console.log(`🚀 Skipping chain bootstrap - chain ${chainId} already scanned via Railgun SDK`);
                  return;
                }

                // Check hydration guard: hydratedChains + hydration lock
                const isHydrating = isChainHydrating(railgunWalletID, chainId);
                let alreadyHydrated = false;
                try {
                  const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
                  if (resp.ok) {
                    const json = await resp.json();
                    const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
                    const hydratedChains = metaKey?.hydratedChains || [];
                    alreadyHydrated = hydratedChains.includes(chainId);
                  }
                } catch {}

                if (alreadyHydrated || isHydrating) {
                  console.log(`🚀 Skipping chain bootstrap - chain ${chainId} already ${alreadyHydrated ? 'hydrated' : 'hydrating'}`);
                  return;
                }

                // Skip bootstrap if wallet is currently scanning/transacting to avoid conflicts
                const isScanning = (typeof window !== 'undefined') &&
                  (window.__RAILGUN_SCANNING_IN_PROGRESS || window.__RAILGUN_TRANSACTION_IN_PROGRESS);
                if (isScanning) {
                  console.log('🚀 Skipping chain bootstrap - wallet currently scanning/transacting');
                  return;
                }

                const hasBootstrap = await checkChainBootstrapAvailable(chainId);
                if (hasBootstrap) {
                  console.log(`🚀 Loading chain ${chainId} bootstrap after auto-init...`);
                  await loadChainBootstrap(railgunWalletID, chainId, {
                    address, // Pass EOA address for Redis scannedChains check
                    onProgress: (progress) => {
                      console.log(`🚀 Auto-bootstrap progress: ${progress}%`);
                      try {
                        window.dispatchEvent(new CustomEvent('chain-bootstrap-progress', {
                          detail: { walletId: railgunWalletID, chainId, progress }
                        }));
                      } catch {}
                    },
                    onComplete: async () => {
                      console.log('🚀 Auto-bootstrap completed');

                      // Mark chain as hydrated in Redis metadata since we loaded bootstrap data
                      try {
                        const persistResp = await fetch('/api/wallet-metadata?action=persist-metadata', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            walletAddress: address,
                            walletId: railgunWalletID,
                            railgunAddress: railgunAddress,
                            hydratedChains: [chainId] // Mark this chain as hydrated
                          })
                        });

                        if (persistResp.ok) {
                          console.log(`✅ Marked hydratedChains += ${chainId} after auto-bootstrap`);
                        } else {
                          console.error(`❌ Failed to mark hydratedChains += ${chainId} after auto-bootstrap:`, await persistResp.text());
                        }
                      } catch (persistError) {
                        console.warn(`⚠️ Error marking chain ${chainId} as hydrated:`, persistError);
                      }
                    },
                    onError: (error) => {
                      console.error('🚀 Auto-bootstrap failed:', error);
                    }
                  });
                } else {
                  console.log(`ℹ️ No chain ${chainId} bootstrap available after auto-init`);
                }
              }
            }
          } catch (hydrationError) {
            console.warn('🚰 Auto-hydration check failed:', hydrationError.message);
          }
        }, 2000); // Wait a bit for wallet to fully initialize
      });
    }
  }, [isConnected, address, isRailgunInitialized, isInitializing, chainId, status, showReturningUserChainModal]);

  // Update Railgun providers when chain or wallet changes - FIXED: Prevent infinite loops
  useEffect(() => {
    const updateRailgunProviders = async () => {
      // 🛡️ CRITICAL: Don't update providers if returning user modal is open
      if (showReturningUserChainModal) {
        console.log('[Railgun Init] ⏸️ Waiting for returning user to select chain before updating providers');
        return;
      }

      if (!isRailgunInitialized || !connector || !chainId) {
        return;
      }

      // Check global rate limiter before attempting provider updates
      resetRPCLimiter();
      if (rpcLimiter.current.isBlocked) {
        console.warn('[RPC-Limiter] 🚫 Global RPC limit reached. Skipping provider update (permanent until disconnect).');
        return;
      }

      try {
        // Immediately notify UI that a scan/refresh will begin for this chain
        try { window.dispatchEvent(new CustomEvent('railgun-scan-started', { detail: { chainId } })); } catch {}
        console.log('🔄 Updating Railgun providers for chain change...', { chainId });
        
        const { loadProvider } = await import('@railgun-community/wallet');
        
        const networkConfigs = [
          { 
            networkName: NetworkName.Ethereum, 
            rpcUrl: RPC_URLS.ethereum, 
            ankrUrl: '/api/rpc?chainId=1&provider=ankr',
            chainId: 1 
          },
          { 
            networkName: NetworkName.Polygon, 
            rpcUrl: RPC_URLS.polygon, 
            ankrUrl: '/api/rpc?chainId=137&provider=ankr',
            chainId: 137 
          },
          { 
            networkName: NetworkName.Arbitrum, 
            rpcUrl: RPC_URLS.arbitrum, 
            ankrUrl: '/api/rpc?chainId=42161&provider=ankr',
            chainId: 42161 
          },
          { 
            networkName: NetworkName.BNBChain, 
            rpcUrl: RPC_URLS.bsc, 
            ankrUrl: '/api/rpc?chainId=56&provider=ankr',
            chainId: 56 
          },
        ];

        // Find the current network
        const currentNetwork = networkConfigs.find(config => config.chainId === chainId);
        if (!currentNetwork) {
          console.warn('⚠️ Unsupported chain for Railgun provider update:', chainId);
          return;
        }

        // Update provider for current chain - FIXED: Use string URL only per official docs with Ankr fallback
        // Note: Hydration now happens during wallet initialization and chain switches separately
        try {
          const fallbackProviderConfig = {
            chainId: currentNetwork.chainId,
            providers: [
              {
                provider: currentNetwork.rpcUrl, // Primary: Alchemy
                priority: 2,
                weight: 1,
                maxLogsPerBatch: 5,
                stallTimeout: 2500,
              },
              {
                provider: currentNetwork.ankrUrl, // Fallback: Ankr (proxied)
                priority: 1,
                weight: 1,                        // Slightly lower weight for fallback
                maxLogsPerBatch: 10,              // Higher batch size for Ankr
                stallTimeout: 3000,               // Slightly higher timeout
              }
            ]
          };

          // Wrap loadProvider with retry limit
          await withRPCRetryLimit(
            () => loadProvider(fallbackProviderConfig, currentNetwork.networkName, 15000),
            currentNetwork.networkName
          );
          console.log(`✅ Updated Railgun provider for ${currentNetwork.networkName} using official format`);
          
          // 🎯 FIXED: Don't auto-resume polling after provider update - let useBalances hook control when to poll
          console.log(`⏸️ Provider updated but remains paused - will resume only when balance refresh needed`);
        } catch (providerError) {
          console.warn('⚠️ Failed to update Railgun provider:', providerError);
          // Don't throw - this is non-critical, RPC fallback will work
        }

        // Note: Chain scanning now handled by chain switch handler, not provider updates

      } catch (error) {
        console.error('❌ Failed to update Railgun providers:', error);
        // Don't throw - prevent crashing the app
      }
    };

    // Run immediately on chain change to eliminate delay before vault creation/scan
    updateRailgunProviders();
    return undefined;
  }, [isRailgunInitialized, showReturningUserChainModal]); // FIXED: Removed chainId dependency - providers don't change on chain switches

  // Handle chain switches - ensure chain is ready without reloading providers
  useEffect(() => {
    const handleChainSwitch = async () => {
      // Only run if wallet is initialized and we have a valid chain
      if (!isRailgunInitialized || !chainId || !address || !railgunWalletID) {
        return;
      }

      // Skip if returning user modal is open
      if (showReturningUserChainModal) {
        console.log('[Chain Switch] ⏸️ Waiting for returning user to select chain');
        return;
      }

      console.log(`[Chain Switch] 🔄 Chain changed to ${chainId}, ensuring ready...`);

      try {
        // Check if chain needs hydration (without forcing provider reload)
        const { isChainHydrating } = await import('../utils/sync/idb-sync/hydration.js');

        let alreadyHydrated = false;
        try {
          const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
          if (resp.ok) {
            const json = await resp.json();
            const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
            const hydratedChains = metaKey?.hydratedChains || [];
            alreadyHydrated = hydratedChains.includes(chainId);
          }
        } catch {}

        const isHydrating = isChainHydrating(railgunWalletID, chainId);

        // Also check Redis for hydratedChains to avoid duplicate hydration
        let alreadyHydratedInRedis = false;
        try {
          const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
          if (resp.ok) {
            const json = await resp.json();
            const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
            const hydratedChains = metaKey?.hydratedChains || [];
            alreadyHydratedInRedis = hydratedChains.includes(chainId);
          }
        } catch {}

        if (alreadyHydrated || isHydrating || alreadyHydratedInRedis) {
          console.log(`[Chain Switch] ⏭️ Chain ${chainId} already ${alreadyHydrated ? 'hydrated locally' : alreadyHydratedInRedis ? 'hydrated in Redis' : 'hydrating'}`);
        } else {
          // Load bootstrap for this chain if needed
          console.log(`[Chain Switch] 🚀 Loading bootstrap for chain ${chainId}...`);
          const { checkChainBootstrapAvailable, loadChainBootstrap } = await import('../utils/sync/idb-sync/hydration.js');

          const hasBootstrap = await checkChainBootstrapAvailable(chainId);
          if (hasBootstrap) {
            await new Promise((resolve, reject) => {
              loadChainBootstrap(railgunWalletID, chainId, {
                address,
                onProgress: (progress) => {
                  console.log(`[Chain Switch] 🚀 Chain ${chainId} bootstrap: ${progress}%`);
                },
                onComplete: () => {
                  console.log(`[Chain Switch] ✅ Chain ${chainId} bootstrap complete`);
                  resolve();
                },
                onError: (error) => {
                  console.warn(`[Chain Switch] ⚠️ Chain ${chainId} bootstrap failed:`, error.message);
                  resolve(); // Continue even if bootstrap fails
                }
              });
            });
          }
        }

        // Ensure chain is scanned (this will check Redis and only scan if needed)
        console.log(`[Chain Switch] 🔍 Ensuring chain ${chainId} is scanned...`);
        await ensureChainScanned(chainId);

        console.log(`[Chain Switch] ✅ Chain ${chainId} is ready`);

      } catch (error) {
        console.warn(`[Chain Switch] ⚠️ Chain switch handling failed for ${chainId}:`, error.message);
        // Don't throw - chain switches shouldn't break the app
      }
    };

    handleChainSwitch();
  }, [chainId, isRailgunInitialized, showReturningUserChainModal, address, railgunWalletID]);

  // Monitor WalletConnect connections and validate chains immediately when chainId becomes available
  const walletConnectValidationRef = useRef({ toastShown: false, lastChainId: null, disconnecting: false });
  const [walletConnectValidating, setWalletConnectValidating] = useState(false);
  useEffect(() => {
    if (isConnected && connector?.id === 'walletConnect' && !walletConnectValidationRef.current.disconnecting) {
      console.log(`[WalletConnect Monitor] Chain ID detected: ${chainId}, validating immediately... (toastShown: ${walletConnectValidationRef.current.toastShown})`);
      setWalletConnectValidating(true);

      // If chainId is NaN, try to get it from the provider directly
      if (chainId === 'NaN' || (typeof chainId === 'number' && isNaN(chainId))) {
        console.log('[WalletConnect Monitor] chainId is NaN, attempting to fetch from provider...');

        // Try to get chainId from provider
        const getChainIdFromProvider = async () => {
          try {
            const walletConnectConnector = connectors.find(c => c.id === 'walletConnect');
            if (!walletConnectConnector) {
              console.log('[WalletConnect Monitor] No WalletConnect connector found');
              return null;
            }

            const provider = await walletConnectConnector.getProvider();
            if (!provider) {
              console.log('[WalletConnect Monitor] No WalletConnect provider found');
              return null;
            }

            const chainIdHex = await provider.request({ method: 'eth_chainId' });
            const providerChainId = parseInt(chainIdHex, 16);

            console.log(`[WalletConnect Monitor] Got chainId from provider: ${providerChainId}`);
            return providerChainId;
          } catch (error) {
            console.warn('[WalletConnect Monitor] Failed to get chainId from provider:', error);
            return null;
          }
        };

        getChainIdFromProvider().then((providerChainId) => {
          if (providerChainId) {
            // Re-run validation with the provider's chainId
            validateChainId(providerChainId);
          } else {
            // If we can't get chainId from provider, wait a bit and try again
            setTimeout(() => {
              if (isConnected && connector?.id === 'walletConnect') {
                console.log('[WalletConnect Monitor] Retrying chainId validation...');
                // This will trigger the useEffect again
              }
            }, 1000);
          }
        });

        setWalletConnectValidating(false);
        return;
      }

      // Helper function to validate chainId
      const validateChainId = (chainIdToValidate) => {
        // Supported networks: Ethereum (1), Polygon (137), Arbitrum (42161), BNB Chain (56)
        const supportedNetworks = { 1: true, 137: true, 42161: true, 56: true };

        // Check if chainId is valid and supported
        const isValidChainIdLocal = chainIdToValidate && !isNaN(chainIdToValidate) && typeof chainIdToValidate === 'number';
        const isSupportedNetwork = isValidChainIdLocal && supportedNetworks[chainIdToValidate];

        if (!isSupportedNetwork) {
          const reason = !isValidChainIdLocal
            ? `Invalid/undefined chainId: ${chainIdToValidate}`
            : `Unsupported network: ${chainIdToValidate}`;

          // Check if we already handled this exact scenario
          if (walletConnectValidationRef.current.toastShown && walletConnectValidationRef.current.lastChainId === chainIdToValidate) {
            console.log(`[WalletConnect Monitor] Skipping duplicate validation for ${reason}`);
            setWalletConnectValidating(false);
            return;
          }

          console.log(`🚫 [WalletConnect Monitor] IMMEDIATE DISCONNECT: ${reason}`);
          walletConnectValidationRef.current.toastShown = true;
          walletConnectValidationRef.current.lastChainId = chainIdToValidate;
          walletConnectValidationRef.current.disconnecting = true;

          // Show error toast immediately
          if (typeof window !== 'undefined') {
            // Import toast dynamically to avoid circular dependencies
            import('react-hot-toast').then(({ toast }) => {
            toast.custom((t) => (
              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-yellow-500/30 bg-black/90 text-yellow-200 shadow-2xl max-w-md">
                  <div className="px-4 py-3 flex items-start gap-3">
                    <div className="h-5 w-5 rounded-full bg-yellow-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">Unsupported Network</div>
                      <div className="text-xs text-yellow-300/80 mt-1">
                        {isValidChainIdLocal
                          ? `Your mobile wallet was connected to an unsupported network (Chain ID: ${chainIdToValidate}). Please switch to Ethereum, Arbitrum, Polygon, or BNB Chain to use LexieVault features.`
                          : `Unable to determine your mobile wallet's network. Please ensure you're connected to Ethereum, Arbitrum, Polygon, or BNB Chain and try again.`
                        }
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      onClick={(e) => {
                        e.stopPropagation();
                        toast.dismiss(t.id);
                      }}
                      className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-yellow-900/30 text-yellow-300/80 flex-shrink-0"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ), { duration: 8000 });
          });
        }

        // Force disconnect after showing the toast
        setTimeout(async () => {
          try {
            await disconnect();
            console.log('[WalletConnect Monitor] Disconnected from unsupported network');
            // Reset flags when disconnected so it can show again for future connections
            setTimeout(() => {
              walletConnectValidationRef.current.toastShown = false;
              walletConnectValidationRef.current.lastChainId = null;
              walletConnectValidationRef.current.disconnecting = false;
              setWalletConnectValidating(false);
            }, 2000); // Longer delay to ensure clean state
          } catch (error) {
            console.error('[WalletConnect Monitor] Disconnect failed:', error);
            // Reset on failure
            walletConnectValidationRef.current.toastShown = false;
            walletConnectValidationRef.current.disconnecting = false;
            setWalletConnectValidating(false);
          }
        }, 200); // Slightly longer delay

            // Dispatch custom event for UI handling
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('walletconnect-unsupported-network', {
                detail: { chainId: chainIdToValidate, supportedNetworks: [1, 137, 42161, 56] }
              }));
            }

            // Also show error in console
            console.error(`🚫 WalletConnect: Unsupported network (Chain ID: ${chainIdToValidate}). Please use Ethereum, Arbitrum, Polygon, or BNB Chain.`);
        } else {
          console.log(`✅ [WalletConnect Monitor] Network ${chainIdToValidate} validated - allowing connection`);
          // Reset flags for successful connections
          walletConnectValidationRef.current.toastShown = false;
          walletConnectValidationRef.current.lastChainId = null;
          walletConnectValidationRef.current.disconnecting = false;
          setWalletConnectValidating(false);
        }
      };

      // If chainId is valid (not NaN), validate it directly
      validateChainId(chainId);
    }
  }, [chainId, isConnected, connector?.id]); // Run whenever chainId changes

  // 🛠️ Debug utilities for encrypted data management
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__LEXIE_RAILGUN_DEBUG__ = {
        // Check current user's Redis wallet data status
        checkWalletData: () => {
          if (!address) return { error: 'No wallet connected' };
          
          return {
            userAddress: address,
            currentRailgunAddress: railgunAddress,
            currentWalletID: railgunWalletID?.slice(0, 8) + '...',
            isInitialized: isRailgunInitialized,
            storageType: 'Redis-only',
            redisData: redisWalletData ? {
              version: redisWalletData.version,
              crossDeviceReady: redisWalletData.crossDeviceReady,
              hasSignature: !!redisWalletData.signature,
              hasEncryptedMnemonic: !!redisWalletData.encryptedMnemonic,
              hasRailgunAddress: !!redisWalletData.railgunAddress,
              hasWalletId: !!redisWalletData.walletId
            } : 'No Redis data found',
            persistenceStatus: redisWalletData?.crossDeviceReady ? 
              '✅ Complete cross-device wallet data in Redis' : 
              redisWalletData ? 'Partial Redis data - needs migration' : 
              'No wallet data - new wallet needed',
            crossDeviceCompatible: redisWalletData?.crossDeviceReady || false
          };
        },
        
        // Check RPC rate limiter status
        checkRPCLimiter: () => {
          resetRPCLimiter();
          return {
            totalAttempts: rpcLimiter.current.totalAttempts,
            maxTotalAttempts: rpcLimiter.current.maxTotalAttempts,
            isBlocked: rpcLimiter.current.isBlocked,
            blockedForSession: rpcLimiter.current.blockedForSession,
            currentSession: isConnected ? address : null,
            isBlockedForCurrentSession: rpcLimiter.current.isBlocked && rpcLimiter.current.blockedForSession === address,
            status: rpcLimiter.current.isBlocked ? 
              '🚫 BLOCKED - Too many failed RPC attempts. Disconnect and reconnect wallet to reset.' : 
              `✅ ACTIVE - ${rpcLimiter.current.totalAttempts}/${rpcLimiter.current.maxTotalAttempts} attempts used`
          };
        },
        
        // Manually reset RPC rate limiter (for debugging)
        resetRPCLimiter: () => {
          const oldStatus = { ...rpcLimiter.current };
          rpcLimiter.current.totalAttempts = 0;
          rpcLimiter.current.isBlocked = false;
          rpcLimiter.current.blockedForSession = null;
          console.log('[Debug] 🔄 Manually reset RPC rate limiter');
          return {
            message: 'RPC rate limiter manually reset (debug only)',
            oldStatus,
            newStatus: { ...rpcLimiter.current }
          };
        },
        
        // NOTE: Redis data cannot be cleared from frontend for security reasons
        clearLocalData: () => {
          if (!address) return { error: 'No wallet connected' };
          
          console.log('ℹ️ Redis-only architecture: No local data to clear');
          
          return {
            userAddress: address,
            message: 'Redis-only architecture: All wallet data is stored in Redis for cross-device access.',
            note: 'To reset wallet, contact support or use a different EOA address.'
          };
        },
      };
      
      console.log('🛠️ Railgun debug utilities available (Redis-only architecture):');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.checkWalletData() // Check Redis wallet status');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.checkRPCLimiter() // Check rate limiter status');  
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.resetRPCLimiter() // Reset rate limiter');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.clearLocalData() // Info about Redis-only storage');
    }
  }, [address, isConnected, railgunAddress, isRailgunInitialized, initializeRailgun]);

  const value = {
    isConnected,
    address,
    chainId,
    isConnecting,
    connectWallet,
    disconnectWallet,
    switchChain: (chainId) => switchChain({ chainId }),
    switchNetwork: (chainId) => switchChain({ chainId }),
    signMessage: signMessageAsync,
    isRailgunInitialized,
    initializeRailgun,
    railgunAddress,
    railgunWalletID,
    isInitializing,
    isInitializingRailgun: isInitializing,
    walletConnectValidating,
    railgunError,
    canUseRailgun: isRailgunInitialized,
    railgunWalletId: railgunWalletID,
    
    // Connection info
    connectedWalletType: connector?.id,
    connectedWalletName: connector?.name,
    
    // 🔑 Wallet signer for SDK operations (avoids re-wrapping in BrowserProvider)
    getWalletSigner,
    walletProvider: getWalletSigner, // Backwards compatibility - but this returns a signer now
    ensureEngineForShield,
    
    getCurrentNetwork: () => {
      const networkNames = { 1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 56: 'BNB Chain' };
      return { id: chainId, name: networkNames[chainId] || `Chain ${chainId}` };
    },
    checkChainReady: async () => {
      try {
        if (!address || !railgunWalletID || !chainId) return false;
        const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
        if (!resp.ok) return false;
        const data = await resp.json();
        const meta = data?.keys?.find((k) => k.walletId === railgunWalletID);
        const scannedChains = meta?.scannedChains || [];
        return Array.isArray(scannedChains) && scannedChains.includes(chainId);
      } catch {
        return false;
      }
    },
    
    supportedNetworks: { 1: true, 137: true, 42161: true, 56: true },
    walletProviders: { METAMASK: 'metamask', WALLETCONNECT: 'walletconnect' },
    
    isWalletAvailable: (type) => {
      if (type === 'metamask') return !!window.ethereum?.isMetaMask;
      if (type === 'walletconnect') return true;
      return false;
    },
    
    getConnectionDebugInfo: () => ({
      isConnected,
      connectorId: connector?.id,
      connectorName: connector?.name,
      railgunInitialized: isRailgunInitialized,
      railgunAddress,
      railgunWalletID: railgunWalletID?.slice(0, 8) + '...',
    }),

    // Lexie ID modal control
    shouldShowLexieIdModal,
    clearLexieIdModalFlag: () => setShouldShowLexieIdModal(false),

    // Lexie ID choice modal control
    showLexieIdChoiceModal,
    handleLexieIdChoice: (wantsLexieId) => {
      if (lexieIdChoicePromise) {
        lexieIdChoicePromise.resolve(wantsLexieId);
      }
    },

  // Lexie ID linking completion
  onLexieIdLinked: () => {
    if (lexieIdLinkPromise) {
      lexieIdLinkPromise.resolve();
    }
  },

  // Returning user chain selection modal control
  showReturningUserChainModal,
  handleReturningUserChainChoice: (confirmed) => {
    if (returningUserChainPromise) {
      returningUserChainPromise.resolve(confirmed);
    }
  },

    // Signature confirmation modal
    showSignatureConfirmation,
    pendingSignatureMessage,
    confirmSignature,
    cancelSignature,

    // Chain scanning
    ensureChainScanned,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};

export const WalletProvider = ({ children }) => {
  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <WalletContextProvider>
          {children}
        </WalletContextProvider>
      </WagmiProvider>
    </QueryClientProvider>
  );
};

export default WalletProvider; 
