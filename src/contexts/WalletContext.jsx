/**
 * Wallet Context Provider - Official Railgun SDK Integration
 * Uses the official @railgun-community/wallet SDK with proper provider management
 * No custom connector hacks - just clean UI layer over official SDK
 */

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { createConfig, custom } from 'wagmi';
import { mainnet, polygon, arbitrum, bsc } from 'wagmi/chains';
import { metaMask, walletConnect, injected } from 'wagmi/connectors';
import { WagmiProvider, useAccount, useConnect, useDisconnect, useSwitchChain, useConnectorClient, useSignMessage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_URLS, WALLETCONNECT_CONFIG, RAILGUN_CONFIG } from '../config/environment';
import { NetworkName } from '@railgun-community/shared-models';

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

async function storeWalletMetadata(walletAddress, walletId, railgunAddress, signature = null, encryptedMnemonic = null) {
  console.log('💾 [STORE-WALLET-METADATA] Starting API call - COMPLETE REDIS STORAGE', {
    walletAddress: walletAddress?.slice(0, 8) + '...',
    walletId: walletId?.slice(0, 8) + '...',
    railgunAddress: railgunAddress?.slice(0, 8) + '...',
    hasSignature: !!signature,
    hasEncryptedMnemonic: !!encryptedMnemonic,
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
        encryptedMnemonic // Store encrypted mnemonic in Redis for cross-device access
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

// Create a client for React Query
const queryClient = new QueryClient();

// Create wagmi config - MINIMAL, just for UI wallet connection
const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum, bsc],
  connectors: [
    injected({ shimDisconnect: true }), // Required for injected wallets like Phantom
    metaMask(),
    walletConnect({
      projectId: WALLETCONNECT_CONFIG.projectId,
      metadata: WALLETCONNECT_CONFIG.metadata,
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
  // AGGRESSIVE: Prevent ANY auto-connection or persistence
  autoConnect: false,
  persist: false,
  storage: null, // Disable wagmi storage completely
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
  // Keep Phantom provider reference until session ends (for blocking)
  const phantomProviderRef = useRef(null);
  const disconnectingRef = useRef(false);
  const lastInitializedAddressRef = useRef(null);
  // Global flag to prevent auto-connections after user disconnects
  const userDisconnectedRef = useRef(false);
  // Track when user last performed an action (button click)
  const lastUserActionAt = useRef(0);

  // Ensure initial full scan is completed for a given chain before user transacts
  const ensureChainScanned = useCallback(async (targetChainId) => {
    try {
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

      // Check Redis-scanned state via wallet metadata proxy
      let alreadyScannedInRedis = false;
      try {
        const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
        if (resp.ok) {
          const json = await resp.json();
          const metaKey = json?.keys?.find((k) => k.walletId === railgunWalletID) || null;
          const scannedChains = metaKey?.scannedChains || [];
          alreadyScannedInRedis = scannedChains.includes(railgunChain.id);
        }
      } catch {}

      const alreadyScannedInWindow = (typeof window !== 'undefined') && window.__RAILGUN_INITIAL_SCAN_DONE && window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id];
      const isAlreadyScanning = chainsScanningRef.current.has(railgunChain.id);

      if (alreadyScannedInRedis || alreadyScannedInWindow) {
        console.log('[Railgun Init] ⏭️ Chain already scanned, skipping:', railgunChain.id);
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
      console.log('[Railgun Init] 🔄 Performing initial full scan for chain', railgunChain.id);

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
  }, [isConnected, address, railgunWalletID]);

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

  // Hard gate against auto-connections: continuously monitor and block unauthorized connections
  useEffect(() => {
    const enforceConnectionGate = async () => {
      if (isConnected && !disconnectingRef.current) {
        const timeSinceUserAction = Date.now() - lastUserActionAt.current;

        // If user has disconnected AND this connection happened >1s after last user action, it's auto-connect
        if (userDisconnectedRef.current && timeSinceUserAction > 1000) {
          console.log('🚫 [HARD-GATE] Detected auto-connection after user disconnect - blocking immediately');
          try {
            await disconnect();
          } catch (error) {
            console.warn('⚠️ [HARD-GATE] Error disconnecting auto-connection:', error);
          }
          return;
        }

        // Strong Phantom detection and blocking
        const isPhantomConnection = (
          // Check wagmi connector name
          (connector && connector.name === 'Phantom') ||
          // Check provider properties
          (selectedInjectedProviderRef.current?.isPhantom ||
           selectedInjectedProviderRef.current?.constructor?.name === 'PhantomProvider') ||
          // Check phantomProviderRef
          phantomProviderRef.current ||
          // Check window.phantom reference
          (typeof window !== 'undefined' && window.phantom?.ethereum?.isPhantom)
        );

        if (isPhantomConnection) {
          const hasDisconnectedPhantom = localStorage.getItem('lexie:phantom:disconnected') === 'true';
          if (hasDisconnectedPhantom) {
            console.log('🚫 [HARD-GATE] Phantom blocked by persistent flag - disconnecting immediately');
            try {
              await disconnect();
            } catch (error) {
              console.warn('⚠️ [HARD-GATE] Error disconnecting blocked Phantom:', error);
            }
            return;
          }
        }
      }
    };

    enforceConnectionGate();
  }, [isConnected, connector]); // Run continuously when connection state changes

  // On app startup, disconnect any auto-connections and respect Phantom blocking
  useEffect(() => {
    const checkAndDisconnectOnStartup = async () => {
      // Small delay to let wagmi initialize
      await new Promise(resolve => setTimeout(resolve, 100));

      // If connected on startup, check if it should be blocked
      if (isConnected) {
        let shouldDisconnect = false;

        // Always disconnect auto-connections on startup (they shouldn't exist)
        if (true) { // This is startup, so any connection is auto
          shouldDisconnect = true;
          console.log('🚫 [STARTUP] Disconnecting auto-connection on startup');
        }

        // Extra check: if Phantom is blocked (strong detection), always disconnect
        const isPhantomOnStartup = (
          (connector && connector.name === 'Phantom') ||
          (selectedInjectedProviderRef.current?.isPhantom ||
           selectedInjectedProviderRef.current?.constructor?.name === 'PhantomProvider') ||
          phantomProviderRef.current ||
          (typeof window !== 'undefined' && window.phantom?.ethereum?.isPhantom)
        );

        if (isPhantomOnStartup) {
          const hasDisconnectedPhantom = localStorage.getItem('lexie:phantom:disconnected') === 'true';
          if (hasDisconnectedPhantom) {
            shouldDisconnect = true;
            console.log('🚫 [STARTUP] Phantom blocked (strong detection) - disconnecting on startup');
          }
        }

        if (shouldDisconnect) {
          try {
            await disconnect();
          } catch (error) {
            console.warn('⚠️ [STARTUP] Error disconnecting on startup:', error);
          }
        }
      }

      // DON'T set the global disconnect flag - that blocks ALL connections
      // Only set it after user explicitly disconnects
    };

    checkAndDisconnectOnStartup();
  }, []); // Run only once on mount

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
      // Record user action timestamp
      lastUserActionAt.current = Date.now();

      // EARLY PHANTOM BLOCK: Check before any wagmi operations
      const isPhantomProvider = (
        // Check provider object
        options?.provider?.isPhantom ||
        // Check window.phantom reference
        (typeof window !== 'undefined' && window.phantom?.ethereum?.isPhantom) ||
        // Check constructor name
        options?.provider?.constructor?.name === 'PhantomProvider' ||
        // Check name in options
        options?.name?.toLowerCase().includes('phantom')
      );

      if (isPhantomProvider) {
        const hasDisconnectedPhantom = localStorage.getItem('lexie:phantom:disconnected') === 'true';
        if (hasDisconnectedPhantom) {
          console.log('🚫 [CONNECT] Phantom blocked by user - refusing connection');
          // Store provider reference for persistent blocking
          if (options?.provider) {
            phantomProviderRef.current = options.provider;
          }
          return;
        } else {
          // Store provider reference when connecting (for future blocking)
          if (options?.provider) {
            phantomProviderRef.current = options.provider;
          }
        }
      }

      // Clear disconnect flag when user explicitly connects (allows future connections)
      if (userDisconnectedRef.current) {
        console.log('✅ [CONNECT] User explicitly connecting - clearing disconnect flag');
        userDisconnectedRef.current = false;
      }

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

        // Clear global disconnect flag - user explicitly connected
        userDisconnectedRef.current = false;

        // Clear Phantom disconnect flag and provider ref if user explicitly connected to Phantom
        if (isPhantomProvider) {
          try {
            localStorage.removeItem('lexie:phantom:disconnected');
            phantomProviderRef.current = null; // Clear provider reference
            console.log('✅ Cleared Phantom disconnect flag and provider ref - user explicitly connected');
          } catch (storageError) {
            console.warn('⚠️ Failed to clear Phantom disconnect flag:', storageError);
          }
        }

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

    // Set global disconnect flag to prevent auto-connections
    userDisconnectedRef.current = true;

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
      // DON'T clear selectedInjectedProviderRef for Phantom - keep it for blocking
      // Only clear for non-Phantom providers
      if (!(selectedInjectedProviderRef.current?.isPhantom ||
            selectedInjectedProviderRef.current?.constructor?.name === 'PhantomProvider')) {
        selectedInjectedProviderRef.current = null;
      }

      // Best-effort: pause Railgun polling quickly
      try {
        const railgunWallet = await import('@railgun-community/wallet');
        if (railgunWallet.pauseAllPollingProviders) {
          railgunWallet.pauseAllPollingProviders();
        }
      } catch {}

      // Try to disconnect from the provider directly (for injected wallets)
      // CRITICAL: Must complete permission revocation before UI cleanup
      try {
        // Special handling for Phantom wallet - it aggressively auto-connects
        if (selectedInjectedProviderRef.current?.isPhantom ||
            selectedInjectedProviderRef.current?.constructor?.name === 'PhantomProvider' ||
            (connector && connector.name === 'Phantom')) {
          console.log('[DISCONNECT] Phantom wallet detected - attempting aggressive disconnect');

          // Mark Phantom as disconnected to prevent auto-reconnection
          try {
            localStorage.setItem('lexie:phantom:disconnected', 'true');
          } catch (storageError) {
            console.warn('[DISCONNECT] Failed to set Phantom disconnect flag:', storageError);
          }

          // CRITICAL: Await permission revocation before proceeding
          try {
            await selectedInjectedProviderRef.current.request({
              method: 'wallet_revokePermissions',
              params: [{ eth_accounts: {} }]
            });
            console.log('[DISCONNECT] Called wallet_revokePermissions for Phantom');
          } catch (revokeError) {
            console.log('[DISCONNECT] wallet_revokePermissions not supported by Phantom');
          }

          // Try Phantom-specific disconnect method
          try {
            if (selectedInjectedProviderRef.current.disconnect) {
              await selectedInjectedProviderRef.current.disconnect();
              console.log('[DISCONNECT] Called Phantom disconnect method');
            }
          } catch (phantomError) {
            console.log('[DISCONNECT] Phantom disconnect method failed');
          }

          // Additional Phantom-specific cleanup
          try { localStorage.removeItem('phantom:connected'); } catch {}
          try { localStorage.removeItem('phantom:autoConnect'); } catch {}
          try { localStorage.removeItem('WALLETCONNECT_DEEPLINK_CHOICE'); } catch {}
        } else {
          // Standard disconnect for other injected wallets
          if (selectedInjectedProviderRef.current?.disconnect) {
            console.log('[DISCONNECT] Calling provider.disconnect()');
            await selectedInjectedProviderRef.current.disconnect();
          } else if (selectedInjectedProviderRef.current && typeof window !== 'undefined') {
            // CRITICAL: Await permission revocation before proceeding
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

      // Aggressive cleanup of ALL storage and wagmi state
      try {
        if (typeof window !== 'undefined') {
          // Clear ALL localStorage to prevent wagmi auto-connect
          try {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
              if (key.includes('wagmi') || key.includes('wallet') || key.includes('connect')) {
                localStorage.removeItem(key);
              }
            });
            localStorage.clear(); // Fallback: clear everything
          } catch {}

          // Clear sessionStorage
          try { sessionStorage.clear(); } catch {}

          // Clear wagmi-specific keys that might persist
          try {
            localStorage.removeItem('wagmi.wallet');
            localStorage.removeItem('wagmi.connected');
            localStorage.removeItem('wagmi.recentConnectorId');
            localStorage.removeItem('wagmi.store');
          } catch {}

          // Clear window globals
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
    if (!isConnected || !address || isInitializing) {
      console.log('Skipping Railgun init:', { isConnected, address: !!address, isInitializing });
      return;
    }

    // Defensive unload: if this is a fresh init start, clear any lingering SDK wallet state
    try {
      if (!isRailgunInitialized) {
        const { clearAllWallets } = await import('../utils/railgun/wallet');
        await clearAllWallets();
        console.log('[Railgun Init] 🧹 Cleared any lingering wallets before hydration');
      }
    } catch {}

    // Suppression flag for pages that only need public EOA + light engine (e.g., PaymentPage)
    try {
      if (typeof window !== 'undefined' && window.__LEXIE_SUPPRESS_RAILGUN_INIT) {
        console.log('[Railgun Init] ⏭️ Suppressed by page flag (__LEXIE_SUPPRESS_RAILGUN_INIT)');
        return;
      }
    } catch {}

    setIsInitializing(true);
    setRailgunError(null);
    
    // ✅ REDIS-ONLY: No localStorage keys needed
    
    // 🚀 REDIS-ONLY: Check Redis for wallet metadata
    let existingSignature = null;
    let existingWalletID = null;
    let existingMnemonic = null;
    let existingRailgunAddress = null;
    let redisWalletData = null;
    
    try {
      console.log('[WalletContext] 📥 Checking Redis for wallet metadata first...', { 
        walletAddress: address?.slice(0, 8) + '...' 
      });
      redisWalletData = await getWalletMetadata(address);
      
      if (redisWalletData) {
        console.log('[WalletContext] ✅ Found wallet metadata in Redis:', {
          walletId: redisWalletData.walletId?.slice(0, 8) + '...',
          railgunAddress: redisWalletData.railgunAddress?.slice(0, 8) + '...',
          walletAddress: redisWalletData.walletAddress?.slice(0, 8) + '...',
          totalKeys: redisWalletData.totalKeys,
          source: 'Redis'
        });
        existingWalletID = redisWalletData.walletId;
        existingRailgunAddress = redisWalletData.railgunAddress;
        
        // ✅ REDIS SUCCESS: If we have both walletID and railgunAddress from Redis, 
        // we can potentially skip wallet creation entirely!
        console.log('[WalletContext] 🎯 Redis provides complete wallet data - will attempt fast hydration');
        
      } else {
        console.log('[WalletContext] ℹ️ No wallet metadata found in Redis, checking localStorage...');
      }
    } catch (redisError) {
      console.warn('[WalletContext] Redis wallet metadata check failed, falling back to localStorage:', redisError);
    }
    
    // ✅ REDIS-ONLY: Pure cross-device persistence (no localStorage fallback)
    if (redisWalletData?.crossDeviceReady) {
      console.log('[WalletContext] 🚀 Using COMPLETE wallet data from Redis - true cross-device access!', {
        version: redisWalletData.version,
        hasSignature: !!redisWalletData.signature,
        hasEncryptedMnemonic: !!redisWalletData.encryptedMnemonic,
        source: 'Redis-only'
      });
      existingSignature = redisWalletData.signature;
      existingMnemonic = redisWalletData.encryptedMnemonic;
      existingWalletID = redisWalletData.walletId;
      existingRailgunAddress = redisWalletData.railgunAddress;
    } else if (redisWalletData) {
      console.log('[WalletContext] ⚠️ Found partial Redis data - wallet needs migration to v2.0 format', {
        version: redisWalletData.version,
        hasSignature: !!redisWalletData.signature,
        hasEncryptedMnemonic: !!redisWalletData.encryptedMnemonic
      });
      // Use what we have from Redis, missing data will be recreated
      existingSignature = redisWalletData.signature;
      existingWalletID = redisWalletData.walletId;
      existingRailgunAddress = redisWalletData.railgunAddress;
    } else {
      console.log('[WalletContext] ℹ️ No Redis data found - will create new wallet for cross-device access');
    }
    
    console.log('[WalletContext] 📊 Wallet data sources (Redis-only architecture):', {
      redisVersion: redisWalletData?.version || 'none',
      crossDeviceReady: redisWalletData?.crossDeviceReady || false,
      walletIdSource: redisWalletData?.walletId ? 'Redis' : 'none',
      signatureSource: redisWalletData?.signature ? 'Redis' : 'none',
      mnemonicSource: redisWalletData?.encryptedMnemonic ? 'Redis' : 'none',
      railgunAddressSource: redisWalletData?.railgunAddress ? 'Redis' : 'none',
      storageStrategy: 'Redis-only (cross-device compatible)',
      needsNewWallet: !redisWalletData?.crossDeviceReady
    });
    
    // 🛡️ PRIMARY GUARD: Check if wallet already exists and is initialized
    const walletAlreadyInitialized = (walletID, expectedRailgunAddress) => {
      return railgunWalletID === walletID && 
             railgunAddress === expectedRailgunAddress && 
             isRailgunInitialized;
    };
    
    if (existingWalletID && existingRailgunAddress && walletAlreadyInitialized(existingWalletID, existingRailgunAddress)) {
      console.log(`✅ Railgun wallet already exists for ${address}:`, {
        walletID: existingWalletID.slice(0, 8) + '...',
        railgunAddress: existingRailgunAddress.slice(0, 8) + '...',
        status: 'initialized',
        source: redisWalletData ? 'Redis-verified' : 'localStorage'
      });
      setIsInitializing(false);
      return;
    }
    
    // 🎯 REDIS FAST PATH: If we have complete data from Redis, try to load directly
    if (existingSignature && existingWalletID && existingRailgunAddress) {
      try {
        console.log('💨 Fast path: Found wallet data in Redis, will load after engine init...', {
          hasSignature: !!existingSignature,
          hasWalletID: !!existingWalletID,
          hasRailgunAddress: !!existingRailgunAddress,
          hasMnemonic: !!existingMnemonic,
          walletIDPreview: existingWalletID.slice(0, 8) + '...',
          railgunAddressPreview: existingRailgunAddress?.slice(0, 8) + '...',
          source: 'Redis-only',
          version: redisWalletData?.version || 'unknown',
          note: existingMnemonic ? 'Complete data - will use fast path' : 'Partial data - will load existing wallet'
        });
        
        // Import required modules for fast path
        const CryptoJS = await import('crypto-js');
        const railgunWallet = await import('@railgun-community/wallet');
        const { 
          startRailgunEngine, 
          loadWalletByID, 
          setLoggers
        } = railgunWallet;
        
        // Validate that loadWalletByID is actually a function
        if (typeof loadWalletByID !== 'function') {
          throw new Error(`loadWalletByID is not a function: ${typeof loadWalletByID}. Available functions: ${Object.keys(railgunWallet).filter(k => typeof railgunWallet[k] === 'function').join(', ')}`);
        }
        
        // Check if engine exists (fallback for older SDK versions)
        let engineExists = false;
        try {
          const { hasEngine } = await import('@railgun-community/wallet');
          if (typeof hasEngine === 'function') {
            engineExists = hasEngine();
          } else {
            console.log('hasEngine is not a function, will attempt engine start');
          }
        } catch (e) {
          console.log('hasEngine not available, will attempt engine start');
        }
        
        // Derive encryption key from existing signature
        const addressBytes = address.toLowerCase().replace('0x', '');
        const signatureBytes = existingSignature.replace('0x', '');
        const combined = signatureBytes + addressBytes;
        const hash = CryptoJS.SHA256(combined);
        const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);
        
                // Ensure engine is started (minimal setup for fast path)
        if (!engineExists) {
          console.log('🔧 Starting minimal Railgun engine for fast path...');
          const LevelJS = (await import('level-js')).default;
          const db = new LevelJS('railgun-engine-db');
          
          const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
          const artifactManager = await createEnhancedArtifactStore(false);
          
          setLoggers(
            (message) => console.log(`🔍 [RAILGUN-SDK] ${message}`),
            (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
          );
          
          await startRailgunEngine(
            'lexiewebsite',
            db,
            true,
            artifactManager.store,
            false,
            false,
            ['https://ppoi.fdi.network/'],
            [],
            true
          );
          
          // Load providers with connected wallet for fast path too  
                  const { loadProvider } = await import('@railgun-community/wallet');
          
          // Check global rate limiter before loading providers
          resetRPCLimiter();
          if (rpcLimiter.current.isBlocked) {
            console.warn('[RPC-Limiter] 🚫 Global RPC limit reached. Skipping provider loading in fast path (permanent until disconnect).');
            throw new Error('RPC rate limit exceeded. Blocked for this wallet session. Please disconnect and reconnect to reset.');
          }
          
          const networkConfigs = [
            { 
              networkName: NetworkName.Ethereum, 
              rpcUrl: RPC_URLS.ethereum, 
              ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=ankr',
              chainId: 1 
            },
            { 
              networkName: NetworkName.Polygon, 
              rpcUrl: RPC_URLS.polygon, 
              ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=ankr',
              chainId: 137 
            },
            { 
              networkName: NetworkName.Arbitrum, 
              rpcUrl: RPC_URLS.arbitrum, 
              ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=ankr',
              chainId: 42161 
            },
            { 
              networkName: NetworkName.BNBChain, 
              rpcUrl: RPC_URLS.bsc, 
              ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=ankr',
              chainId: 56 
            },
          ];

          for (const { networkName, rpcUrl, ankrUrl, chainId: netChainId } of networkConfigs) {
            try {
              // FIXED: RAILGUN SDK requires string URLs only per official documentation
              // https://docs.railgun.org/developer-guide/wallet/getting-started/4.-add-networks-and-rpc-providers
              console.log(`[RAILGUN] Loading provider for ${networkName} using official SDK format...`);
              
              // DEBUG: Log exact values being passed to RAILGUN SDK
              console.log(`[RAILGUN-DEBUG] Values for ${networkName}:`, {
                networkName: networkName,
                networkNameType: typeof networkName,
                rpcUrl: rpcUrl,
                rpcUrlType: typeof rpcUrl,
                chainId: netChainId,
                chainIdType: typeof netChainId
              });
              
              const fallbackProviderConfig = {
                chainId: netChainId,
                providers: [
                  {
                    provider: rpcUrl,     // Primary: Alchemy
                    priority: 2,
                    weight: 1,
                    maxLogsPerBatch: 5,
                    stallTimeout: 2500,
                  },
                  {
                    provider: ankrUrl,    // Fallback: Ankr
                    priority: 1,
                    weight: 1,            // Slightly lower weight for fallback
                    maxLogsPerBatch: 10,  // Higher batch size for Ankr
                    stallTimeout: 3000,   // Slightly higher timeout
                  }
                ]
              };
              
              // DEBUG: Log the exact config being passed
              console.log(`[RAILGUN-DEBUG] Config for ${networkName}:`, JSON.stringify(fallbackProviderConfig, null, 2));

              // Wrap loadProvider with retry limit
              await withRPCRetryLimit(
                () => loadProvider(fallbackProviderConfig, networkName, 15000),
                networkName
              );
              console.log(`✅ Provider loaded for ${networkName} using official format`);
            } catch (error) {
              console.warn(`⚠️ Fast path provider load failed for ${networkName}:`, error);
            }
          }
          
          // Balance callbacks are handled centrally in sdk-callbacks.js

          // 🛑 CRITICAL: Pause providers immediately after loading to prevent wasteful polling
          console.log('⏸️ Pausing RAILGUN providers to prevent RPC polling until wallet connects...');
          const { pauseAllPollingProviders } = await import('@railgun-community/wallet');
          pauseAllPollingProviders(); // Stop polling until user actually needs it
          console.log('✅ RAILGUN providers paused - will resume when needed');
        }
        
        // 🔑 Load existing wallet using stored walletID (SDK can restore from ID + encryption key)
        console.log('🔑 Loading existing Railgun wallet with stored ID...', {
          walletIDPreview: existingWalletID.slice(0, 8) + '...',
          hasEncryptionKey: !!encryptionKey,
          encryptionKeyLength: encryptionKey?.length,
          walletIDLength: existingWalletID?.length
        });
        
        // Validate parameters before calling loadWalletByID
        if (!encryptionKey || typeof encryptionKey !== 'string') {
          throw new Error(`Invalid encryptionKey: ${typeof encryptionKey}`);
        }
        if (!existingWalletID || typeof existingWalletID !== 'string') {
          throw new Error(`Invalid existingWalletID: ${typeof existingWalletID}`);
        }
        
        const railgunWalletInfo = await loadWalletByID(encryptionKey, existingWalletID, false);
        
        // Verify wallet loaded correctly
        if (!railgunWalletInfo?.id || !railgunWalletInfo?.railgunAddress) {
          throw new Error(`Loaded wallet info is incomplete: ${JSON.stringify({
            hasID: !!railgunWalletInfo?.id,
            hasAddress: !!railgunWalletInfo?.railgunAddress,
            walletInfo: railgunWalletInfo
          })}`);
        }
        
        // Verify the loaded wallet ID matches what we expected
        if (railgunWalletInfo.id !== existingWalletID) {
          throw new Error(`Wallet ID mismatch: expected ${existingWalletID.slice(0, 8)}, got ${railgunWalletInfo.id?.slice(0, 8)}`);
        }
        
        // ✅ Hydrate React state - this is the key part that prevents recreation
        setRailgunAddress(railgunWalletInfo.railgunAddress);
        setRailgunWalletID(railgunWalletInfo.id);
        setIsRailgunInitialized(true);
        // Notify UI that wallet metadata already exists and is ready for polling
        try { window.dispatchEvent(new CustomEvent('railgun-wallet-metadata-ready', { detail: { address, walletId: railgunWalletInfo.id } })); } catch {}
        
        console.log('✅ Fast path successful - existing wallet loaded:', {
          userAddress: address,
          railgunAddress: railgunWalletInfo.railgunAddress,
          walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
          storage: 'Redis-only'
        });
        
        // 🔄 Run initial Merkle-tree scan and balance refresh for CURRENT chain only (prevent infinite polling)
        try {
          const { refreshBalances } = await import('@railgun-community/wallet');
          const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
          // Resolve current chain
          let railgunChain = null;
          for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
            if (cfg.chain.id === chainId) { railgunChain = cfg.chain; break; }
          }
          if (railgunChain) {
            // Strictly check Redis first to decide whether to scan
            try {
              const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
              let redisHasChain = false;
              if (resp.ok) {
                const data = await resp.json();
                const metaKey = data?.keys?.find((k) => k.walletId === railgunWalletInfo.id);
                const scannedChains = metaKey?.scannedChains || [];
                redisHasChain = Array.isArray(scannedChains) && scannedChains.includes(railgunChain.id);
              }
              if (redisHasChain) {
                console.log('[Railgun Init] ⏭️ Skipping initial scan (found in Redis) for chain', railgunChain.id);
              } else {
                console.log('[Railgun Init] 🔄 Performing initial balance refresh for chain', railgunChain.id);
                // Start UI polling exactly when refresh begins
                try { window.dispatchEvent(new CustomEvent('vault-poll-start', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
                await refreshBalances(railgunChain, [railgunWalletInfo.id]);
                try { window.dispatchEvent(new CustomEvent('vault-poll-complete', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
                if (typeof window !== 'undefined') {
                  window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
                  window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id] = true;
                }
                // Persist scannedChains to Redis metadata
                try {
                  const getResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
                  let existing = {};
                  let scannedChains = [];
                  if (getResp.ok) {
                    const data = await getResp.json();
                    const metaKey = data?.keys?.find((k) => k.walletId === railgunWalletInfo.id);
                    if (metaKey) {
                      scannedChains = Array.from(new Set([...(metaKey.scannedChains || []), railgunChain.id]));
                      existing = {
                        railgunAddress: metaKey.railgunAddress,
                        signature: metaKey.signature,
                        encryptedMnemonic: metaKey.encryptedMnemonic,
                        privateBalances: metaKey.privateBalances,
                        scannedChains,
                      };
                    }
                  }
                  const persistResp = await fetch('/api/wallet-metadata', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletAddress: address, walletId: railgunWalletInfo.id, ...existing })
                  });
                  if (persistResp.ok) {
                    console.log('[Railgun Init] 💾 Persisted scannedChains to Redis:', {
                      chainId: railgunChain.id,
                      walletId: railgunWalletInfo.id?.slice(0,8) + '...'
                    });
                  }
                } catch {}
                console.log('[Railgun Init] ✅ Initial scan complete for chain', railgunChain.id);
              }
            } catch (e) {
              console.warn('[Railgun Init] ⚠️ Failed to read scannedChains from Redis, proceeding with scan:', e?.message);
              await refreshBalances(railgunChain, [railgunWalletInfo.id]);
            }
          } else {
            console.warn('[Railgun Init] ⚠️ Unable to resolve Railgun chain for initial scan; chainId:', chainId);
          }
        } catch (scanError) {
          console.warn('[Railgun Init] ⚠️ Initial balance refresh failed (continuing):', scanError?.message);
        }

        setIsInitializing(false);
        return; // ✨ Exit early - wallet successfully loaded from storage
        
      } catch (hydrateError) {
        console.error('❌ Fast path failed, falling back to full initialization:', {
          error: hydrateError.message,
          stack: hydrateError.stack,
          errorType: hydrateError.constructor.name,
          walletID: existingWalletID?.slice(0, 8) + '...',
          hasSignature: !!existingSignature,
          hasMnemonic: !!existingMnemonic
        });
      }
    }
    
    console.log('🚀 Full initialization required...', {
      reason: !existingSignature ? 'No signature' : 
              !existingWalletID ? 'No walletID' : 
              !existingMnemonic ? 'No mnemonic' : 'Fast path failed'
    });
    
    // 🚀 Request signature ASAP to avoid UI delay (before engine/provider loading)
    try {
      if (!existingSignature) {
        const signatureMessage = `LexieVault Creation\nAddress: ${address}\n\nSign this message to create your LexieVault.`;
        try {
          window.dispatchEvent(new CustomEvent('railgun-signature-requested', { detail: { address } }));
        } catch (_) {}
        const earlySignature = await signMessageAsync({ message: signatureMessage });
        console.log('✅ Early signature acquired prior to engine init:', address);
        // Persist into flow variables so later steps reuse it and don't prompt again
        existingSignature = earlySignature;
      }
    } catch (earlySigError) {
      console.error('❌ Early signature request failed:', earlySigError);
      throw earlySigError; // Fail init so UI can surface the error cleanly
    }

    try {
      // Import the official Railgun SDK
      const {
        startRailgunEngine,
        loadProvider,
        createRailgunWallet,
        loadWalletByID,
        setLoggers
      } = await import('@railgun-community/wallet');
      
      console.log('✅ Official Railgun SDK imported');

      // Step 1: Initialize Railgun Engine with official SDK
      const LevelJS = (await import('level-js')).default;
      const db = new LevelJS('railgun-engine-db');
      
      // Use existing artifact store
      const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
      const artifactManager = await createEnhancedArtifactStore(false);
      
      // Set up official SDK logging
      setLoggers(
        (message) => {
          try {
            // Parse simple progress hints like: "Trying to decrypt commitment. Current index 23151/1999"
            const match = /Current index\s+(\d+)\/(\d+)/i.exec(message || '');
            if (match) {
              const current = Number(match[1]);
              const total = Number(match[2]) || 1;
              const percent = Math.max(0, Math.min(100, Math.floor((current / total) * 100)));
              window.dispatchEvent(new CustomEvent('railgun-init-progress', { detail: { current, total, percent, message } }));
            }
          } catch (_) {}
          console.log(`🔍 [RAILGUN-SDK] ${message}`);
        },
        (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
      );

      // Start engine with official SDK
      // Signal init starting for UI
      try { window.dispatchEvent(new CustomEvent('railgun-init-started', { detail: { address } })); } catch {}

      await startRailgunEngine(
        'lexiewebsite',
        db,
        true, // shouldDebug
        artifactManager.store,
        false, // useNativeArtifacts (web)
        false, // skipMerkletreeScans
        ['https://ppoi.fdi.network/'], // POI nodes
        [], // customPOILists
        true // verboseScanLogging
      );
      console.log('✅ Railgun engine started with official SDK');

      // Step 2: Load providers using connected wallet's provider when possible
              const networkConfigs = [
          { 
            networkName: NetworkName.Ethereum, 
            rpcUrl: RPC_URLS.ethereum, 
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=1&provider=ankr',
            chainId: 1 
          },
          { 
            networkName: NetworkName.Polygon, 
            rpcUrl: RPC_URLS.polygon, 
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=137&provider=ankr',
            chainId: 137 
          },
          { 
            networkName: NetworkName.Arbitrum, 
            rpcUrl: RPC_URLS.arbitrum, 
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=42161&provider=ankr',
            chainId: 42161 
          },
          { 
            networkName: NetworkName.BNBChain, 
            rpcUrl: RPC_URLS.bsc, 
            ankrUrl: (typeof window !== 'undefined' ? window.location.origin : '') + '/api/rpc?chainId=56&provider=ankr',
            chainId: 56 
          },
        ];

      // Check global rate limiter before loading providers
      resetRPCLimiter();
      if (rpcLimiter.current.isBlocked) {
        console.warn('[RPC-Limiter] 🚫 Global RPC limit reached. Limiting provider loading to current chain only (permanent until disconnect).');
        // Only load provider for current chain when rate limited - this is essential for transactions
        const currentChainConfig = networkConfigs.find(config => config.chainId === chainId);
        if (currentChainConfig) {
          console.log('[RPC-Limiter] ⚡ Loading provider for current chain despite rate limit (essential for transactions)');
          try {
            // FIXED: Use only string URL as per official RAILGUN SDK documentation with Ankr fallback
            const fallbackProviderConfig = {
              chainId: currentChainConfig.chainId,
              providers: [
                {
                  provider: currentChainConfig.rpcUrl,  // Primary: Alchemy
                  priority: 2,
                  weight: 1,
                  maxLogsPerBatch: 5,
                  stallTimeout: 2500,
                },
                {
                  provider: currentChainConfig.ankrUrl, // Fallback: Ankr (proxied)
                  priority: 1,
                  weight: 1,                           // Slightly lower weight for fallback
                  maxLogsPerBatch: 10,                 // Higher batch size for Ankr
                  stallTimeout: 3000,                  // Slightly higher timeout
                }
              ]
            };

            // Load provider for current chain only
            await withRPCRetryLimit(
              () => loadProvider(fallbackProviderConfig, currentChainConfig.networkName, 15000),
              currentChainConfig.networkName,
              1 // Reduced retries when rate limited
            );
            console.log(`✅ Provider loaded for current chain ${currentChainConfig.networkName} despite rate limit`);
          } catch (error) {
            console.warn(`⚠️ Failed to load provider for current chain ${currentChainConfig.networkName}:`, error);
          }
        }
      } else {
        for (const { networkName, rpcUrl, ankrUrl, chainId: netChainId } of networkConfigs) {
          try {
            // FIXED: RAILGUN SDK requires string URLs only per official documentation
            // https://docs.railgun.org/developer-guide/wallet/getting-started/4.-add-networks-and-rpc-providers
            console.log(`📡 Loading provider for ${networkName} using official SDK format...`);
            
            // DEBUG: Log exact values being passed to RAILGUN SDK
            console.log(`[RAILGUN-DEBUG] Full init values for ${networkName}:`, {
              networkName: networkName,
              networkNameType: typeof networkName,
              rpcUrl: rpcUrl,
              rpcUrlType: typeof rpcUrl,
              chainId: netChainId,
              chainIdType: typeof netChainId
            });
            
            const fallbackProviderConfig = {
              chainId: netChainId,
              providers: [
                {
                  provider: rpcUrl,     // Primary: Alchemy
                  priority: 2,
                  weight: 1,
                  maxLogsPerBatch: 5,
                  stallTimeout: 2500,
                },
                {
                  provider: ankrUrl,    // Fallback: Ankr (proxied)
                  priority: 1,
                  weight: 1,            // Slightly lower weight for fallback
                  maxLogsPerBatch: 10,  // Higher batch size for Ankr
                  stallTimeout: 3000,   // Slightly higher timeout
                }
              ]
            };
            
            // DEBUG: Log the exact config being passed
            console.log(`[RAILGUN-DEBUG] Full init config for ${networkName}:`, JSON.stringify(fallbackProviderConfig, null, 2));

            // Wrap loadProvider with retry limit
            await withRPCRetryLimit(
              () => loadProvider(fallbackProviderConfig, networkName, 15000),
              networkName
            );
            console.log(`✅ Provider loaded for ${networkName} using official SDK format`);
          } catch (error) {
            console.warn(`⚠️ Failed to load provider for ${networkName}:`, error);
          }
        }
      }

      // Step 3: Balance callbacks are handled centrally in sdk-callbacks.js

      // 🛑 CRITICAL: Pause providers after full initialization to prevent wasteful polling
      console.log('⏸️ Pausing RAILGUN providers after full init to prevent RPC polling...');
      const { pauseAllPollingProviders } = await import('@railgun-community/wallet');
      pauseAllPollingProviders(); // Stop polling until user actually needs it
      console.log('✅ RAILGUN providers paused after full init - will resume when needed');

      // Step 4: Wallet creation/loading with official SDK
      const bip39 = await import('bip39');
      const { Mnemonic, randomBytes } = await import('ethers');
      const CryptoJS = await import('crypto-js');

      // Get or create signature for this EOA - Redis-only approach
      let signature = existingSignature; // From Redis
      
      if (!signature) {
        // First time for this EOA or migration needed - request signature
        const signatureMessage = `LexieVault Creation\nAddress: ${address}\n\nSign this message to create your LexieVault.`;
        // Notify UI that a signature is being requested
        try {
          window.dispatchEvent(new CustomEvent('railgun-signature-requested', { detail: { address } }));
        } catch (_) {}
        signature = await signMessageAsync({ message: signatureMessage });
        console.log('✅ New signature created for cross-device wallet access:', address);
      } else {
        console.log('✅ Using existing signature from Redis:', address);
      }
      
      // Derive encryption key from stored signature (always same for same EOA)
      const addressBytes = address.toLowerCase().replace('0x', '');
      const signatureBytes = signature.replace('0x', '');
      const combined = signatureBytes + addressBytes;
      const hash = CryptoJS.SHA256(combined);
      const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

      // User-specific storage (Redis-only approach)
      const savedWalletID = existingWalletID; // From Redis only
      let railgunWalletInfo;

      if (savedWalletID && existingRailgunAddress) {
        // Load existing wallet using Redis data
        console.log('👛 Full init: Loading existing Railgun wallet from Redis...', { 
          walletID: savedWalletID.slice(0, 8) + '...',
          railgunAddress: existingRailgunAddress.slice(0, 8) + '...',
          userAddress: address,
          source: 'Redis-only',
          version: redisWalletData?.version || 'unknown'
        });
        
        try {
          // 🛡️ Graceful error handling for invalid/corrupted data
          railgunWalletInfo = await loadWalletByID(encryptionKey, savedWalletID, false);
          console.log('✅ Existing Railgun wallet loaded successfully in full init');
        } catch (loadError) {
          console.warn('⚠️ Failed to load existing wallet - will regenerate from same signature and mnemonic:', loadError);
          // Don't clear localStorage - use same signature to recreate deterministically
          railgunWalletInfo = null;
        }
      }

      if (!railgunWalletInfo) {
        // 🛡️ Additional guard: Don't create if we already have one in state
        if (railgunWalletID && railgunAddress) {
          console.log('⚠️ Preventing wallet creation - already have wallet in state:', {
            existingWalletID: railgunWalletID.slice(0, 8) + '...',
            existingAddress: railgunAddress.slice(0, 8) + '...'
          });
          setIsInitializing(false);
          return;
        }
        
        // 🔄 If railgunWalletID exists but wallet isn't initialized, rehydrate mnemonic first
        if (existingWalletID && !walletAlreadyInitialized(existingWalletID, existingRailgunAddress)) {
          console.log('🔄 WalletID exists but not initialized - will rehydrate from storage:', {
            walletID: existingWalletID.slice(0, 8) + '...',
            railgunAddress: existingRailgunAddress?.slice(0, 8) + '...',
            hasSignature: !!existingSignature,
            hasMnemonic: !!existingMnemonic,
            source: redisWalletData ? 'Redis' : 'localStorage'
          });
        }
        
        // 🆕 Only create new wallet if we truly don't have one
        console.log('🔑 Creating NEW Railgun wallet (none exists for this EOA)...', { 
          userAddress: address,
          reason: !savedWalletID ? 'No stored walletID' : 'Failed to load existing wallet',
          hasStoredData: { signature: !!existingSignature, mnemonic: !!existingMnemonic }
        });
        
        // 🔄 Check for existing encrypted mnemonic from Redis
        let mnemonic = null;
        const savedEncryptedMnemonic = existingMnemonic; // From Redis only
        
        if (savedEncryptedMnemonic) {
          try {
            // 🔓 Attempt to decrypt existing mnemonic from Redis
            console.log('🔓 Decrypting mnemonic from Redis...', {
              hasEncryptedMnemonic: !!savedEncryptedMnemonic,
              source: 'Redis-only',
              version: redisWalletData?.version || 'unknown'
            });
            
            const decryptedBytes = CryptoJS.AES.decrypt(savedEncryptedMnemonic, encryptionKey);
            const decryptedMnemonic = decryptedBytes.toString(CryptoJS.enc.Utf8);
            
            // 🛡️ Validate decrypted mnemonic
            if (decryptedMnemonic && bip39.validateMnemonic(decryptedMnemonic)) {
              mnemonic = decryptedMnemonic;
              console.log('✅ Successfully decrypted and validated mnemonic from Redis');
            } else {
              throw new Error('Decrypted mnemonic failed validation');
            }
            
          } catch (decryptError) {
            console.warn('⚠️ Failed to decrypt Redis mnemonic - will create new wallet:', decryptError);
            // Create new wallet since Redis data is corrupted
          }
        }
        
        if (!mnemonic) {
          // 🆕 Generate fresh secure mnemonic for Redis storage
          console.log('🆕 Generating new cryptographically secure mnemonic for Redis...');
          mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase.trim();
          
          if (!bip39.validateMnemonic(mnemonic)) {
            throw new Error('Generated mnemonic failed validation');
          }
          
          console.log('✅ Generated new secure mnemonic (will be stored in Redis only)');
        }
        
        // 🏗️ Create wallet with official SDK
        const creationBlockNumberMap = {
          [NetworkName.Ethereum]: undefined,
          [NetworkName.Polygon]: undefined,
          [NetworkName.Arbitrum]: undefined,
          [NetworkName.BNBChain]: undefined,
        };
        
        try {
          railgunWalletInfo = await createRailgunWallet(
            encryptionKey,
            mnemonic,
            creationBlockNumberMap
          );
          
          // 🚀 REDIS-ONLY: Store COMPLETE wallet data for true cross-device persistence
          try {
            // Encrypt mnemonic for Redis storage
            const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, encryptionKey).toString();
            
            const storeSuccess = await storeWalletMetadata(
              address, 
              railgunWalletInfo.id, 
              railgunWalletInfo.railgunAddress, 
              signature,
              encryptedMnemonic // Store encrypted mnemonic in Redis
            );
            
            if (storeSuccess) {
              console.log('✅ Stored COMPLETE wallet data to Redis for true cross-device access:', {
                walletId: railgunWalletInfo.id?.slice(0, 8) + '...',
                railgunAddress: railgunWalletInfo.railgunAddress?.slice(0, 8) + '...',
                hasSignature: !!signature,
                hasEncryptedMnemonic: !!encryptedMnemonic,
                redisKey: `railgun:${address}:${railgunWalletInfo.id}`,
                crossDeviceReady: true,
                version: '2.0'
              });
              
              console.log('🎉 Wallet is now accessible from ANY device/browser!');
              // Notify UI that wallet metadata has been persisted and polling can start
              try { window.dispatchEvent(new CustomEvent('railgun-wallet-metadata-ready', { detail: { address, walletId: railgunWalletInfo.id } })); } catch {}
            } else {
              console.warn('⚠️ Redis storage failed - wallet will only work on this device');
            }
          } catch (redisError) {
            console.warn('⚠️ Failed to store wallet metadata to Redis (non-critical):', redisError);
          }
          
                  console.log('✅ Created and saved new Railgun wallet:', {
          userAddress: address,
          walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
          railgunAddress: railgunWalletInfo.railgunAddress?.slice(0, 8) + '...',
          storage: 'Redis-only',
          crossDevice: true
        });
          
        } catch (createError) {
          console.error('❌ Failed to create Railgun wallet:', createError);
          throw new Error(`Railgun wallet creation failed: ${createError.message}`);
        }
      }

      // Set wallet state - Redis-only persistence
      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(railgunWalletInfo.id);
      setIsRailgunInitialized(true);

      console.log('✅ Wallet state updated - all data persisted in Redis for cross-device access');
      // Notify UI that metadata is persisted; polling may begin
      try { window.dispatchEvent(new CustomEvent('railgun-wallet-metadata-ready', { detail: { address, walletId: railgunWalletInfo.id } })); } catch {}

      // 🔄 Run initial Merkle-tree scan and balance refresh for CURRENT chain only (prevent infinite polling)
      try {
        const { refreshBalances } = await import('@railgun-community/wallet');
        const { NETWORK_CONFIG } = await import('@railgun-community/shared-models');
        let railgunChain = null;
        for (const [, cfg] of Object.entries(NETWORK_CONFIG)) {
          if (cfg.chain.id === chainId) { railgunChain = cfg.chain; break; }
        }
        if (railgunChain) {
          const scanKey = `railgun-initial-scan:${address?.toLowerCase()}:${railgunWalletInfo.id}:${railgunChain.id}`;
          const alreadyScanned = typeof window !== 'undefined' && (window.__RAILGUN_INITIAL_SCAN_DONE?.[railgunChain.id] || localStorage.getItem(scanKey) === '1');
          if (!alreadyScanned) {
            console.log('[Railgun Init] 🔄 Performing initial balance refresh for chain', railgunChain.id);
            // Start UI polling exactly when refresh begins
            try { window.dispatchEvent(new CustomEvent('vault-poll-start', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
            await refreshBalances(railgunChain, [railgunWalletInfo.id]);
            try { window.dispatchEvent(new CustomEvent('vault-poll-complete', { detail: { address, walletId: railgunWalletInfo.id, chainId: railgunChain.id } })); } catch {}
            if (typeof window !== 'undefined') {
              window.__RAILGUN_INITIAL_SCAN_DONE = window.__RAILGUN_INITIAL_SCAN_DONE || {};
              window.__RAILGUN_INITIAL_SCAN_DONE[railgunChain.id] = true;
              try { localStorage.setItem(scanKey, '1'); } catch {}
            }
            // Persist scannedChains to Redis metadata
            try {
              const getResp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`);
              let existing = {};
              let scannedChains = [];
              if (getResp.ok) {
                const data = await getResp.json();
                const metaKey = data?.keys?.find((k) => k.walletId === railgunWalletInfo.id);
                if (metaKey) {
                  scannedChains = Array.from(new Set([...(metaKey.scannedChains || []), railgunChain.id]));
                  existing = {
                    railgunAddress: metaKey.railgunAddress,
                    signature: metaKey.signature,
                    encryptedMnemonic: metaKey.encryptedMnemonic,
                    privateBalances: metaKey.privateBalances,
                    scannedChains,
                  };
                }
              }
            const persistResp = await fetch('/api/wallet-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress: address, walletId: railgunWalletInfo.id, ...existing })
            });
            if (persistResp.ok) {
              console.log('[Railgun Init] 💾 Persisted scannedChains to Redis:', {
                chainId: railgunChain.id,
                walletId: railgunWalletInfo.id?.slice(0,8) + '...'
              });
            } else {
              console.warn('[Railgun Init] ⚠️ Failed to persist scannedChains to Redis:', await persistResp.text());
            }
            } catch {}
            console.log('[Railgun Init] ✅ Initial scan complete for chain', railgunChain.id);
          } else {
            console.log('[Railgun Init] ⏭️ Skipping initial scan (already completed) for chain', railgunChain.id);
          }
        } else {
          console.warn('[Railgun Init] ⚠️ Unable to resolve Railgun chain for initial scan; chainId:', chainId);
        }
      } catch (scanError) {
        console.warn('[Railgun Init] ⚠️ Initial balance refresh failed (continuing):', scanError?.message);
      }

      console.log('🎉 Railgun initialization completed with official SDK:', {
        userAddress: address,
        railgunAddress: railgunWalletInfo.railgunAddress,
        walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
        storage: 'Redis-only',
        crossDevice: true
      });

      // Signal init completed for UI with 100%
      try { window.dispatchEvent(new CustomEvent('railgun-init-completed', { detail: { address } })); } catch {}

      // 🎯 FIXED: Don't auto-resume polling after init - let useBalances hook control when to poll
      console.log('⏸️ Providers remain paused after init - will resume only when balance refresh needed');

    } catch (error) {
      console.error('❌ Railgun initialization failed:', error);
      setRailgunError(error.message || 'Failed to initialize Railgun');
      setIsRailgunInitialized(false);
      setRailgunAddress(null);
      setRailgunWalletID(null);
      try { window.dispatchEvent(new CustomEvent('railgun-init-failed', { detail: { error: error?.message || String(error) } })); } catch {}
    } finally {
      setIsInitializing(false);
    }
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
    // 🛡️ Prevent force reinitialization if already initialized
    if (isRailgunInitialized) {
      console.log('✅ Railgun already initialized for:', address);
      
      // 🎯 FIXED: Don't auto-resume polling - let useBalances hook control when to poll
      console.log('⏸️ Providers remain paused - will resume only when balance refresh needed');
      return;
    }
    
    // Respect suppression flag (PaymentPage)
    if (typeof window !== 'undefined' && window.__LEXIE_SUPPRESS_RAILGUN_INIT) {
      console.log('[Railgun Init] ⏭️ Suppressed auto-init due to page flag');
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

    // CRITICAL: Respect user disconnect guard - don't auto-init if user disconnected
    if (userDisconnectedRef.current) {
      console.log('[Railgun Init] ⏭️ Suppressed by user-disconnect guard');
      return;
    }

    // Prevent same-address re-init immediately after disconnect; require explicit reconnect
    if (lastInitializedAddressRef.current && lastInitializedAddressRef.current === address) {
      console.log('[Railgun Init] ⏭️ Skipping auto-init for same address until explicit reconnect');
      return;
    }

    if (isConnected && address && !isInitializing) {
      console.log('🚀 Auto-initializing Railgun for connected wallet:', address);
      lastInitializedAddressRef.current = address;
      initializeRailgun();
    }
  }, [isConnected, address, isRailgunInitialized, isInitializing, chainId, status]);

  // Update Railgun providers when chain or wallet changes - FIXED: Prevent infinite loops
  useEffect(() => {
    const updateRailgunProviders = async () => {
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

        // Ensure chain has done its initial scan once providers are updated
        try {
          await ensureChainScanned(chainId);
        } catch (e) {
          console.warn('[Railgun Init] ⚠️ ensureChainScanned failed after provider update:', e?.message);
        }

      } catch (error) {
        console.error('❌ Failed to update Railgun providers:', error);
        // Don't throw - prevent crashing the app
      }
    };

    // Run immediately on chain change to eliminate delay before vault creation/scan
    updateRailgunProviders();
    return undefined;
  }, [chainId, isRailgunInitialized]); // FIXED: Removed connector?.id dependency to reduce triggers

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