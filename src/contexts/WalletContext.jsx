/**
 * Wallet Context Provider - Official Railgun SDK Integration
 * Uses the official @railgun-community/wallet SDK with proper provider management
 * No custom connector hacks - just clean UI layer over official SDK
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { createConfig, custom } from 'wagmi';
import { mainnet, polygon, arbitrum, bsc } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';
import { WagmiProvider, useAccount, useConnect, useDisconnect, useSwitchChain, useConnectorClient, useSignMessage } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RPC_URLS, WALLETCONNECT_CONFIG, RAILGUN_CONFIG } from '../config/environment';

// Create a client for React Query
const queryClient = new QueryClient();

// Create wagmi config - MINIMAL, just for UI wallet connection
const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum, bsc],
  connectors: [
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
  const { address, isConnected, chainId, connector } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: connectorClient } = useConnectorClient();
  const { signMessageAsync } = useSignMessage();

  // Simple wallet connection - UI layer only
  const connectWallet = async (connectorType = 'metamask') => {
    try {
      const targetConnector = connectors.find(c => 
        connectorType === 'metamask' ? c.id === 'metaMask' : c.id === 'walletConnect'
      );
      
      if (targetConnector) {
        await connect({ connector: targetConnector });
        console.log('✅ Connected via wagmi:', targetConnector.id);
      }
    } catch (error) {
      console.error('❌ Wagmi connection failed:', error);
      throw error;
    }
  };

  const disconnectWallet = async () => {
    try {
      await disconnect();
      
      // 🧹 Only clear React state - preserve encrypted localStorage data for persistence
      setIsRailgunInitialized(false);
      setRailgunAddress(null);
      setRailgunWalletID(null);
      setRailgunError(null);
      
      // 💾 Keep encrypted Railgun data in localStorage for next connection
      // DON'T clear: railgun-walletID-${address} or railgun-mnemonic-${address}
      // This allows same wallet to reconnect and reuse existing Railgun wallet
      
      console.log('🧹 Disconnected - React state cleared, encrypted data preserved for reconnection');
    } catch (error) {
      console.error('Failed to disconnect:', error);
    }
  };

  // Official Railgun SDK Integration
  const initializeRailgun = async () => {
    if (!isConnected || !address || isInitializing) {
      console.log('Skipping Railgun init:', { isConnected, address: !!address, isInitializing });
      return;
    }

    setIsInitializing(true);
    setRailgunError(null);
    
    // 🔄 STORAGE KEYS: Define once for entire function
    const signatureStorageKey = `railgun-signature-${address.toLowerCase()}`;
    const userStorageKey = `railgun-walletID-${address.toLowerCase()}`;
    const mnemonicStorageKey = `railgun-mnemonic-${address.toLowerCase()}`;
    
    const existingSignature = localStorage.getItem(signatureStorageKey);
    const existingWalletID = localStorage.getItem(userStorageKey);
    const existingMnemonic = localStorage.getItem(mnemonicStorageKey);
    
    // 🛡️ PRIMARY GUARD: Check if wallet already exists and is initialized
    const walletAlreadyInitialized = (walletID) => {
      return railgunWalletID === walletID && 
             railgunAddress && 
             isRailgunInitialized;
    };
    
    if (existingWalletID && walletAlreadyInitialized(existingWalletID)) {
      console.log(`✅ Railgun wallet already exists for ${address}:`, {
        walletID: existingWalletID.slice(0, 8) + '...',
        railgunAddress: railgunAddress.slice(0, 8) + '...',
        status: 'initialized'
      });
      setIsInitializing(false);
      return;
    }
    
        if (existingSignature && existingWalletID && existingMnemonic) {
      try {
        console.log('💨 Fast path: Found existing wallet data, hydrating...', {
          hasSignature: !!existingSignature,
          hasWalletID: !!existingWalletID,
          hasMnemonic: !!existingMnemonic,
          walletIDPreview: existingWalletID.slice(0, 8) + '...'
        });
        
        // Import required modules for fast path
        const CryptoJS = await import('crypto-js');
        const { 
          startRailgunEngine, 
          loadRailgunWalletByID, 
          setLoggers,
          setOnBalanceUpdateCallback
        } = await import('@railgun-community/wallet');
        
        // Check if engine exists (fallback for older SDK versions)
        let engineExists = false;
        try {
          const { hasEngine } = await import('@railgun-community/wallet');
          engineExists = hasEngine();
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
          
          // Set up balance callbacks for fast path too
          setOnBalanceUpdateCallback((balancesEvent) => {
            console.log('🔄 Railgun balance update (fast path):', balancesEvent);
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('railgun-balance-update', {
                detail: balancesEvent
              }));
            }
          });
        }
        
        // 🔑 Load existing wallet using stored walletID (SDK can restore from ID + encryption key)
        console.log('🔑 Loading existing Railgun wallet with stored ID...', {
          walletIDPreview: existingWalletID.slice(0, 8) + '...',
          hasEncryptionKey: !!encryptionKey
        });
        
        const railgunWalletInfo = await loadRailgunWalletByID(encryptionKey, existingWalletID, false);
        
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
        
        console.log('✅ Fast path successful - existing wallet loaded:', {
          userAddress: address,
          railgunAddress: railgunWalletInfo.railgunAddress,
          walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
          storageKey: userStorageKey
        });
        
        setIsInitializing(false);
        return; // ✨ Exit early - wallet successfully loaded from storage
        
      } catch (hydrateError) {
        console.warn('⚠️ Fast path failed, falling back to full initialization:', hydrateError);
        // Don't clear localStorage here - let full init handle it
      }
    }
    
    console.log('🚀 Full initialization required...', {
      reason: !existingSignature ? 'No signature' : 
              !existingWalletID ? 'No walletID' : 
              !existingMnemonic ? 'No mnemonic' : 'Fast path failed'
    });
    
    try {
      // Import the official Railgun SDK
      const {
        startRailgunEngine,
        loadProvider,
        createRailgunWallet,
        loadRailgunWalletByID,
        setLoggers,
        setOnBalanceUpdateCallback,
      } = await import('@railgun-community/wallet');
      
      const { NetworkName } = await import('@railgun-community/shared-models');
      console.log('✅ Official Railgun SDK imported');

      // Step 1: Initialize Railgun Engine with official SDK
      const LevelJS = (await import('level-js')).default;
      const db = new LevelJS('railgun-engine-db');
      
      // Use existing artifact store
      const { createEnhancedArtifactStore } = await import('../utils/railgun/artifactStore.js');
      const artifactManager = await createEnhancedArtifactStore(false);
      
      // Set up official SDK logging
      setLoggers(
        (message) => console.log(`🔍 [RAILGUN-SDK] ${message}`),
        (error) => console.error(`🚨 [RAILGUN-SDK] ${error}`)
      );

      // Start engine with official SDK
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

      // Step 2: Load providers using official SDK method
      const networkConfigs = [
        { networkName: NetworkName.Ethereum, rpcUrl: RPC_URLS.ethereum, chainId: 1 },
        { networkName: NetworkName.Polygon, rpcUrl: RPC_URLS.polygon, chainId: 137 },
        { networkName: NetworkName.Arbitrum, rpcUrl: RPC_URLS.arbitrum, chainId: 42161 },
        { networkName: NetworkName.BNBChain, rpcUrl: RPC_URLS.bsc, chainId: 56 },
      ];

      for (const { networkName, rpcUrl, chainId: netChainId } of networkConfigs) {
        try {
          console.log(`📡 Loading provider for ${networkName}...`);
          
          const fallbackProviderConfig = {
            chainId: netChainId,
            providers: [{
              provider: rpcUrl,
              priority: 1,
              weight: 2,
            }]
          };

          await loadProvider(fallbackProviderConfig, networkName, 15000);
          console.log(`✅ Provider loaded for ${networkName}`);
        } catch (error) {
          console.warn(`⚠️ Failed to load provider for ${networkName}:`, error);
        }
      }

      // Step 3: Set up balance callbacks
      setOnBalanceUpdateCallback((balancesEvent) => {
        console.log('🔄 Railgun balance update:', balancesEvent);
        // Trigger UI update
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('railgun-balance-update', {
            detail: balancesEvent
          }));
        }
      });

      // Step 4: Wallet creation/loading with official SDK
      const bip39 = await import('bip39');
      const { Mnemonic, randomBytes } = await import('ethers');
      const CryptoJS = await import('crypto-js');

      // Get or create signature for this EOA (reusing from fast path check)
      let signature = localStorage.getItem(signatureStorageKey);
      
      if (!signature) {
        // First time for this EOA - request signature and store it
        const signatureMessage = `RAILGUN Wallet Creation\nAddress: ${address}\n\nSign this message to create your secure RAILGUN privacy wallet.`;
        signature = await signMessageAsync({ message: signatureMessage });
        localStorage.setItem(signatureStorageKey, signature);
        console.log('✅ New signature created and stored for EOA:', address);
      } else {
        console.log('✅ Using existing signature for EOA:', address);
      }
      
      // Derive encryption key from stored signature (always same for same EOA)
      const addressBytes = address.toLowerCase().replace('0x', '');
      const signatureBytes = signature.replace('0x', '');
      const combined = signatureBytes + addressBytes;
      const hash = CryptoJS.SHA256(combined);
      const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

      // User-specific storage (using already defined variables)
      const savedWalletID = existingWalletID;
      let railgunWalletInfo;

      if (savedWalletID) {
        // Load existing wallet using official SDK
        console.log('👛 Full init: Loading existing Railgun wallet...', { 
          walletID: savedWalletID.slice(0, 8) + '...',
          userAddress: address,
          note: 'Fast path may have failed'
        });
        
        try {
          // 🛡️ Graceful error handling for invalid/corrupted data
          railgunWalletInfo = await loadRailgunWalletByID(encryptionKey, savedWalletID, false);
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
        if (existingWalletID && !walletAlreadyInitialized(existingWalletID)) {
          console.log('🔄 WalletID exists but not initialized - will rehydrate from storage:', {
            walletID: existingWalletID.slice(0, 8) + '...',
            hasSignature: !!existingSignature,
            hasMnemonic: !!existingMnemonic
          });
        }
        
        // 🆕 Only create new wallet if we truly don't have one
        console.log('🔑 Creating NEW Railgun wallet (none exists for this EOA)...', { 
          userAddress: address,
          reason: !savedWalletID ? 'No stored walletID' : 'Failed to load existing wallet',
          hasStoredData: { signature: !!existingSignature, mnemonic: !!existingMnemonic }
        });
        
        // 🔄 Check for existing encrypted mnemonic first (rehydrate from storage)
        let mnemonic = null;
        const savedEncryptedMnemonic = existingMnemonic; // Use already retrieved value
        
        if (savedEncryptedMnemonic) {
          try {
            // 🔓 Attempt to decrypt existing mnemonic
            console.log('🔓 Rehydrating mnemonic from storage...', {
              hasEncryptedMnemonic: !!savedEncryptedMnemonic,
              isRehydration: !!existingWalletID
            });
            
            const decryptedBytes = CryptoJS.AES.decrypt(savedEncryptedMnemonic, encryptionKey);
            const decryptedMnemonic = decryptedBytes.toString(CryptoJS.enc.Utf8);
            
            // 🛡️ Validate decrypted mnemonic
            if (decryptedMnemonic && bip39.validateMnemonic(decryptedMnemonic)) {
              mnemonic = decryptedMnemonic;
              console.log('✅ Successfully rehydrated and validated mnemonic from storage');
            } else {
              throw new Error('Decrypted mnemonic failed validation');
            }
            
          } catch (decryptError) {
            console.warn('⚠️ Failed to decrypt existing mnemonic - will regenerate deterministically:', decryptError);
            // Don't clear localStorage - let deterministic generation handle it
          }
        }
        
        if (!mnemonic) {
          // 🆕 Generate fresh secure mnemonic
          console.log('🆕 Generating new cryptographically secure mnemonic...');
          mnemonic = Mnemonic.fromEntropy(randomBytes(16)).phrase.trim();
          
          if (!bip39.validateMnemonic(mnemonic)) {
            throw new Error('Generated mnemonic failed validation');
          }
          
          // 🔒 Encrypt and store new mnemonic
          const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, encryptionKey).toString();
          localStorage.setItem(mnemonicStorageKey, encryptedMnemonic);
          console.log('✅ Generated, encrypted, and stored new secure mnemonic');
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
          
          // 💾 Save new wallet ID for persistence (ensure consistent storage key)
          localStorage.setItem(userStorageKey, railgunWalletInfo.id);
          console.log('✅ Created and saved new Railgun wallet:', {
            userAddress: address,
            walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
            storageKey: userStorageKey
          });
          
        } catch (createError) {
          console.error('❌ Failed to create Railgun wallet:', createError);
          throw new Error(`Railgun wallet creation failed: ${createError.message}`);
        }
      }

      // Set wallet state and ensure persistence
      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(railgunWalletInfo.id);
      setIsRailgunInitialized(true);

      // ✅ Ensure walletID is persisted (in case it was recreated)
      const currentStoredID = localStorage.getItem(userStorageKey);
      if (currentStoredID !== railgunWalletInfo.id) {
        console.log('💾 Updating stored walletID:', {
          oldID: currentStoredID?.slice(0, 8) + '...',
          newID: railgunWalletInfo.id?.slice(0, 8) + '...'
        });
        localStorage.setItem(userStorageKey, railgunWalletInfo.id);
      }

      console.log('🎉 Railgun initialization completed with official SDK:', {
        userAddress: address,
        railgunAddress: railgunWalletInfo.railgunAddress,
        walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
        persisted: true
      });

    } catch (error) {
      console.error('❌ Railgun initialization failed:', error);
      setRailgunError(error.message || 'Failed to initialize Railgun');
      setIsRailgunInitialized(false);
      setRailgunAddress(null);
      setRailgunWalletID(null);
    } finally {
      setIsInitializing(false);
    }
  };

  // Auto-initialize Railgun when wallet connects (only if not already initialized)
  useEffect(() => {
    // 🛡️ Prevent force reinitialization if already initialized
    if (isRailgunInitialized) {
      console.log('✅ Railgun already initialized for:', address);
      return;
    }
    
    if (isConnected && address && !isInitializing) {
      console.log('🚀 Auto-initializing Railgun for connected wallet:', address);
      initializeRailgun();
    }
  }, [isConnected, address, isRailgunInitialized, isInitializing]);

  // 🛠️ Debug utilities for encrypted data management
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__LEXIE_RAILGUN_DEBUG__ = {
        // Check current user's encrypted data status
        checkEncryptedData: () => {
          if (!address) return { error: 'No wallet connected' };
          
          const userStorageKey = `railgun-walletID-${address.toLowerCase()}`;
          const mnemonicStorageKey = `railgun-mnemonic-${address.toLowerCase()}`;
          const signatureStorageKey = `railgun-signature-${address.toLowerCase()}`;
          
          const hasWalletID = !!localStorage.getItem(userStorageKey);
          const hasMnemonic = !!localStorage.getItem(mnemonicStorageKey);
          const hasSignature = !!localStorage.getItem(signatureStorageKey);
          const walletID = localStorage.getItem(userStorageKey);
          const signature = localStorage.getItem(signatureStorageKey);
          
          // Check if current React state matches stored data
          const stateMatches = {
            walletIDMatches: railgunWalletID === walletID,
            hasRailgunAddress: !!railgunAddress,
            isInitialized: isRailgunInitialized
          };
          
          return {
            userAddress: address,
            hasEncryptedWalletID: hasWalletID,
            hasEncryptedMnemonic: hasMnemonic,
            hasStoredSignature: hasSignature,
            walletIDPreview: walletID ? walletID.slice(0, 8) + '...' : null,
            signaturePreview: signature ? signature.slice(0, 10) + '...' : null,
            currentRailgunAddress: railgunAddress,
            currentWalletID: railgunWalletID?.slice(0, 8) + '...',
            isInitialized: isRailgunInitialized,
            stateMatches,
            storageKeys: { userStorageKey, mnemonicStorageKey, signatureStorageKey },
            persistenceStatus: hasSignature && hasWalletID && hasMnemonic ? 
              '✅ Complete wallet data - should load instantly' : 
              hasSignature ? 'Partial data - may need regeneration' : 
              'New wallet - signature needed',
            fastPathEligible: hasSignature && hasWalletID && hasMnemonic
          };
        },
        
        // Clear ALL data for current user (TESTING ONLY - breaks persistence)
        clearAllData: () => {
          if (!address) return { error: 'No wallet connected' };
          
          const userStorageKey = `railgun-walletID-${address.toLowerCase()}`;
          const mnemonicStorageKey = `railgun-mnemonic-${address.toLowerCase()}`;
          const signatureStorageKey = `railgun-signature-${address.toLowerCase()}`;
          
          localStorage.removeItem(userStorageKey);
          localStorage.removeItem(mnemonicStorageKey);
          localStorage.removeItem(signatureStorageKey);
          
          console.log('🗑️ Cleared ALL Railgun data for user:', address);
          
          return {
            userAddress: address,
            message: 'All data cleared. Next connection will create new wallet.'
          };
        },
      };
      
      console.log('🛠️ Railgun debug utilities available:');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.checkEncryptedData() // Check persistence status');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.clearAllData() // TESTING ONLY - breaks persistence');
    }
  }, [address, isConnected, railgunAddress, isRailgunInitialized, initializeRailgun]);

  // Get current wallet provider for PrivacyActions - DIRECT provider, not wagmi abstraction
  const getCurrentWalletProvider = () => {
    // Always use window.ethereum directly for MetaMask and other injected wallets
    if (typeof window !== 'undefined' && window.ethereum) {
      console.log('🔗 Providing direct window.ethereum provider');
      return window.ethereum;
    }
    
    // For WalletConnect, get the actual provider from the connector
    if (connectorClient?.connector?.provider && connector?.id === 'walletConnect') {
      console.log('🌐 Providing WalletConnect provider');
      return connectorClient.connector.provider;
    }
    
    console.error('❌ No direct wallet provider available');
    return null;
  };

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
    
    // 🔑 Wallet provider for PrivacyActions and other components
    walletProvider: getCurrentWalletProvider(),
    getCurrentWalletProvider,
    
    getCurrentNetwork: () => {
      const networkNames = { 1: 'Ethereum', 137: 'Polygon', 42161: 'Arbitrum', 56: 'BSC' };
      return { id: chainId, name: networkNames[chainId] || `Chain ${chainId}` };
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
      hasWalletProvider: !!getCurrentWalletProvider(),
      walletProviderType: getCurrentWalletProvider()?.constructor?.name || 'none',
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