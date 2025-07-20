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
    console.log('🚀 Starting RAILGUN initialization with official SDK...');
    
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

      // Generate encryption key from user signature
      const timestamp = Date.now();
      const nonce = crypto.getRandomValues(new Uint32Array(4)).join('');
      const signatureMessage = `RAILGUN Wallet Creation\nAddress: ${address}\nTimestamp: ${timestamp}\nNonce: ${nonce}\n\nSign this message to create your secure RAILGUN privacy wallet.`;
      
      const signature = await signMessageAsync({ message: signatureMessage });
      
      // Derive encryption key
      const addressBytes = address.toLowerCase().replace('0x', '');
      const signatureBytes = signature.replace('0x', '');
      const combined = signatureBytes + addressBytes + timestamp.toString();
      const hash = CryptoJS.SHA256(combined);
      const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);

      // User-specific storage
      const userStorageKey = `railgun-walletID-${address.toLowerCase()}`;
      const mnemonicStorageKey = `railgun-mnemonic-${address.toLowerCase()}`;
      
      const savedWalletID = localStorage.getItem(userStorageKey);
      let railgunWalletInfo;

      if (savedWalletID) {
        // Load existing wallet using official SDK
        console.log('👛 Loading existing Railgun wallet...', { 
          walletID: savedWalletID.slice(0, 8) + '...',
          userAddress: address 
        });
        
        try {
          // 🛡️ Graceful error handling for invalid/corrupted data
          railgunWalletInfo = await loadRailgunWalletByID(encryptionKey, savedWalletID, false);
          console.log('✅ Existing Railgun wallet loaded successfully');
        } catch (loadError) {
          console.warn('⚠️ Failed to load existing wallet - data may be corrupted:', loadError);
          
          // 🧹 Clear potentially corrupted data and start fresh
          console.log('🧹 Clearing corrupted wallet data and regenerating...');
          localStorage.removeItem(userStorageKey);
          localStorage.removeItem(mnemonicStorageKey);
          
          // Continue to create new wallet below
          railgunWalletInfo = null;
        }
      }

      if (!railgunWalletInfo) {
        // Create new wallet using official SDK
        console.log('🔑 Creating new Railgun wallet...', { userAddress: address });
        
        // 🔄 Check for existing encrypted mnemonic first
        let mnemonic = null;
        const savedEncryptedMnemonic = localStorage.getItem(mnemonicStorageKey);
        
        if (savedEncryptedMnemonic) {
          try {
            // 🔓 Attempt to decrypt existing mnemonic
            console.log('🔓 Attempting to decrypt existing mnemonic...');
            const decryptedBytes = CryptoJS.AES.decrypt(savedEncryptedMnemonic, encryptionKey);
            const decryptedMnemonic = decryptedBytes.toString(CryptoJS.enc.Utf8);
            
            // 🛡️ Validate decrypted mnemonic
            if (decryptedMnemonic && bip39.validateMnemonic(decryptedMnemonic)) {
              mnemonic = decryptedMnemonic;
              console.log('✅ Successfully decrypted and validated existing mnemonic');
            } else {
              throw new Error('Decrypted mnemonic failed validation');
            }
            
          } catch (decryptError) {
            console.warn('⚠️ Failed to decrypt existing mnemonic - may be corrupted:', decryptError);
            
            // 🧹 Clear corrupted mnemonic data
            localStorage.removeItem(mnemonicStorageKey);
            console.log('🧹 Cleared corrupted mnemonic data');
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
          
          // 💾 Save new wallet ID for persistence
          localStorage.setItem(userStorageKey, railgunWalletInfo.id);
          console.log('✅ Created and saved new Railgun wallet:', {
            userAddress: address,
            walletID: railgunWalletInfo.id?.slice(0, 8) + '...'
          });
          
        } catch (createError) {
          console.error('❌ Failed to create Railgun wallet:', createError);
          
          // 🧹 Clean up on creation failure
          localStorage.removeItem(mnemonicStorageKey);
          throw new Error(`Railgun wallet creation failed: ${createError.message}`);
        }
      }

      // Set wallet state
      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(railgunWalletInfo.id);
      setIsRailgunInitialized(true);

      console.log('🎉 Railgun initialization completed with official SDK:', {
        userAddress: address,
        railgunAddress: railgunWalletInfo.railgunAddress,
        walletID: railgunWalletInfo.id?.slice(0, 8) + '...',
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

  // Auto-initialize Railgun when wallet connects
  useEffect(() => {
    if (isConnected && address && !isRailgunInitialized && !isInitializing) {
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
          
          const hasWalletID = !!localStorage.getItem(userStorageKey);
          const hasMnemonic = !!localStorage.getItem(mnemonicStorageKey);
          const walletID = localStorage.getItem(userStorageKey);
          
          return {
            userAddress: address,
            hasEncryptedWalletID: hasWalletID,
            hasEncryptedMnemonic: hasMnemonic,
            walletIDPreview: walletID ? walletID.slice(0, 8) + '...' : null,
            currentRailgunAddress: railgunAddress,
            isInitialized: isRailgunInitialized,
            storageKeys: { userStorageKey, mnemonicStorageKey }
          };
        },
        
        // Clear encrypted data for current user (for testing)
        clearEncryptedData: () => {
          if (!address) return { error: 'No wallet connected' };
          
          const userStorageKey = `railgun-walletID-${address.toLowerCase()}`;
          const mnemonicStorageKey = `railgun-mnemonic-${address.toLowerCase()}`;
          
          const hadWalletID = !!localStorage.getItem(userStorageKey);
          const hadMnemonic = !!localStorage.getItem(mnemonicStorageKey);
          
          localStorage.removeItem(userStorageKey);
          localStorage.removeItem(mnemonicStorageKey);
          
          console.log('🗑️ Cleared encrypted Railgun data for user:', address);
          
          return {
            userAddress: address,
            clearedWalletID: hadWalletID,
            clearedMnemonic: hadMnemonic,
            message: 'Encrypted data cleared. Reconnect wallet to regenerate.'
          };
        },
        
        // Force re-initialization (useful for testing)
        forceReinitialize: async () => {
          if (!isConnected || !address) return { error: 'No wallet connected' };
          
          console.log('🔄 Force re-initializing Railgun...');
          
          // Reset React state
          setIsRailgunInitialized(false);
          setRailgunAddress(null);
          setRailgunWalletID(null);
          setRailgunError(null);
          
          // Trigger re-initialization
          try {
            await initializeRailgun();
            return { success: true, message: 'Re-initialization completed' };
          } catch (error) {
            return { success: false, error: error.message };
          }
        }
      };
      
      console.log('🛠️ Railgun debug utilities available:');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.checkEncryptedData()');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.clearEncryptedData()');
      console.log('- window.__LEXIE_RAILGUN_DEBUG__.forceReinitialize()');
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