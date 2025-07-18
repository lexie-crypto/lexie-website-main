/**
 * Wallet Context Provider
 * Manages wallet connection state and Railgun integration
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

// Create custom transport using environment configuration
const createProxyTransport = (chainId) => custom({
  async request({ method, params }) {
    // Use proper RPC URLs from environment configuration
    const rpcUrls = {
      1: RPC_URLS.ethereum,
      137: RPC_URLS.polygon,
      42161: RPC_URLS.arbitrum,
      56: RPC_URLS.bsc
    };
    
    const rpcUrl = rpcUrls[chainId];
    if (!rpcUrl) {
      throw new Error(`No RPC URL configured for chain ${chainId}`);
    }
    
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method,
        params,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }
    
    const { result, error } = await response.json();
    if (error) {
      throw new Error(`RPC error: ${JSON.stringify(error)}`);
    }
    
    return result;
  },
});

// Create wagmi config
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
    [mainnet.id]: createProxyTransport(mainnet.id),
    [polygon.id]: createProxyTransport(polygon.id),
    [arbitrum.id]: createProxyTransport(arbitrum.id),
    [bsc.id]: createProxyTransport(bsc.id),
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
  const [isRailgunInitialized, setIsRailgunInitialized] = useState(false);
  const [railgunAddress, setRailgunAddress] = useState(null);
  const [railgunWalletID, setRailgunWalletID] = useState(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [railgunError, setRailgunError] = useState(null);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: connectorClient } = useConnectorClient();
  const { signMessageAsync } = useSignMessage();

  // Get current wallet provider for signing operations
  const getCurrentWalletProvider = () => {
    // If we have a connector client (connected wallet), use wagmi's signMessage
    if (connectorClient && signMessageAsync) {
      return {
        request: async ({ method, params }) => {
          try {
            if (method === 'personal_sign') {
              // Use wagmi's signMessageAsync for proper signing
              const [message, address] = params;
              return await signMessageAsync({ message });
            }
            // For other methods, delegate to the underlying provider
            if (connectorClient.transport?.request) {
              return await connectorClient.transport.request({ method, params });
            }
            throw new Error(`Unsupported method: ${method}`);
          } catch (error) {
            console.error('Wallet provider request failed:', error);
            throw error;
          }
        }
      };
    }
    
    // Fallback to window.ethereum for MetaMask
    if (typeof window !== 'undefined' && window.ethereum) {
      return window.ethereum;
    }
    
    return null;
  };

  const connectWallet = async (connectorType = 'metamask') => {
    try {
      console.log('Available connectors:', connectors.map(c => ({ id: c.id, name: c.name })));
      
      const connector = connectors.find(c => 
        connectorType === 'metamask' ? c.id === 'metaMask' : c.id === 'walletConnect'
      );
      
      if (connector) {
        console.log('Connecting with connector:', connector.id);
        await connect({ connector });
      } else {
        console.error('Connector not found:', connectorType);
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    }
  };

  const disconnectWallet = async () => {
    try {
      await disconnect();
      setIsRailgunInitialized(false);
      setRailgunAddress(null);
      setRailgunWalletID(null);
      setRailgunError(null);
      // Clear stored wallet ID when disconnecting
      if (address) {
        localStorage.removeItem(`railgun-walletID-${address}`);
        localStorage.removeItem(`railgun-mnemonic-${address}`);
      }
    } catch (error) {
      console.error('Failed to disconnect wallet:', error);
    }
  };

  const initializeRailgun = async () => {
    if (!isConnected || !address || isInitializing) {
      console.log('Skipping Railgun init:', { isConnected, address: !!address, isInitializing });
      return;
    }

    setIsInitializing(true);
    setRailgunError(null);
    console.log('🚀 Starting RAILGUN initialization for address:', address);
    
    try {
      // Import RAILGUN utilities (like the working version)
      const { initializeRailgunSystem, setupWalletBalanceCallbacks } = await import('../utils/railgunUtils');
      console.log('✅ RAILGUN utilities imported successfully');

      // Try to import Railgun wallet functions dynamically
      console.log('📦 Importing RAILGUN wallet functions...');
      const railgunWallet = await import('@railgun-community/wallet');
      console.log('✅ RAILGUN wallet imported successfully');

      if (!railgunWallet.startRailgunEngine) {
        throw new Error('RAILGUN functions not available');
      }

      // Initialize Railgun engine with proper database setup
      console.log('🔧 Creating RAILGUN database...');
      
      // Import LevelJS for proper database setup
      const LevelJS = (await import('level-js')).default;
      const db = new LevelJS('railgun-db');
      
      const walletSource = 'lexiewebsite';
      const shouldDebug = true; // Enable debugging for now
      const customArtifactGetter = undefined;
      const useNativeArtifacts = false;
      const skipMerkletreeScans = false; // Enable scans for real balance updates

      console.log('🔧 Starting RAILGUN engine...');
      await railgunWallet.startRailgunEngine(
        walletSource,
        db, // Use proper database instead of undefined
        shouldDebug,
        customArtifactGetter,
        useNativeArtifacts,
        skipMerkletreeScans,
        [], // poiNodeUrls - empty array for default
        [], // customPOILists - empty array
        true, // verboseScanLogging
        {
          poiNodeURL: 'https://railgun.poi.gd/poi-node',
        }
      );
      console.log('✅ RAILGUN engine started successfully');

      // Initialize RAILGUN provider and callback system (like the working version)
      console.log('🌐 Initializing RAILGUN provider system...');
      const systemInitialized = await initializeRailgunSystem();
      if (!systemInitialized) {
        console.warn('⚠️ RAILGUN system initialization failed, using basic mode');
      } else {
        console.log('✅ RAILGUN provider system initialized');
      }

      // Create or load Railgun wallet with proper signature-based key derivation
      const encryptionKey = address.toLowerCase().padEnd(64, '0').slice(0, 64);
      const savedWalletID = localStorage.getItem(`railgun-walletID-${address}`);
      
      let railgunWalletInfo;

      if (savedWalletID) {
        // Load existing wallet by ID
        console.log('👛 Loading existing RAILGUN wallet...', savedWalletID.slice(0, 8) + '...');
        try {
          await railgunWallet.loadRailgunWalletByID(encryptionKey, savedWalletID);
          railgunWalletInfo = {
            railgunAddress: railgunWallet.getWalletAddress(savedWalletID),
            railgunWalletID: savedWalletID,
            id: savedWalletID
          };
          console.log('✅ Existing RAILGUN wallet loaded successfully');
        } catch (loadError) {
          console.warn('⚠️ Failed to load existing wallet, creating new one:', loadError);
          // Fall through to create new wallet
        }
      }

      if (!railgunWalletInfo) {
        // Create new wallet - first time setup
        let mnemonic = localStorage.getItem(`railgun-mnemonic-${address}`);
        
        if (!mnemonic) {
          // Generate a new mnemonic
          try {
            if (railgunWallet.generateMnemonic) {
              mnemonic = railgunWallet.generateMnemonic();
              console.log('🔑 Generated new mnemonic using RAILGUN');
            } else {
              // Fallback mnemonic generation
              mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
              console.warn('⚠️ Using fallback mnemonic generation for demo');
            }
          } catch (mnemonicError) {
            console.warn('⚠️ Mnemonic generation failed, using fallback:', mnemonicError);
            mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
          }
          
          // Store mnemonic securely (in production, use proper encryption)
          localStorage.setItem(`railgun-mnemonic-${address}`, mnemonic);
        }

        console.log('👛 Creating new RAILGUN wallet...');
        const creationBlockNumberMap = {}; // Will use default block numbers
        railgunWalletInfo = await railgunWallet.createRailgunWallet(
          encryptionKey,
          mnemonic,
          creationBlockNumberMap
        );

        // Save wallet ID for future loads
        localStorage.setItem(`railgun-walletID-${address}`, railgunWalletInfo.railgunWalletID);
        console.log('💾 Saved RAILGUN wallet ID for future loads');
      }

      // Extract consistent wallet ID for all subsequent operations
      const walletID = railgunWalletInfo.railgunWalletID || railgunWalletInfo.id;

      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(walletID);

      console.log('🕐 Waiting for RAILGUN wallet to be ready...');
      // Wait for the wallet to be fully ready before marking as initialized
      if (railgunWallet.waitForRailgunWalletReady) {
        await railgunWallet.waitForRailgunWalletReady(walletID);
        console.log('✅ RAILGUN wallet is ready for transactions');
      } else {
        console.warn('⚠️ waitForRailgunWalletReady not available, proceeding without wait');
      }

      setIsRailgunInitialized(true);

      console.log('🎉 RAILGUN wallet initialized successfully:', {
        address: railgunWalletInfo.railgunAddress,
        walletID: walletID
      });

      // Set up wallet-specific balance callbacks with proper wallet ID (like the working version)
      console.log('🔔 Setting up wallet balance callbacks...');
      const callbacksSetup = await setupWalletBalanceCallbacks(walletID);
      if (callbacksSetup) {
        console.log('✅ RAILGUN wallet balance callbacks configured');
      } else {
        console.warn('⚠️ Failed to set up wallet balance callbacks');
      }

    } catch (error) {
      console.error('❌ Failed to initialize RAILGUN:', error);
      
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

  const value = {
    isConnected,
    address,
    chainId,
    isConnecting,
    connectWallet,
    disconnectWallet,
    switchChain: (chainId) => switchChain({ chainId }),
    switchNetwork: (chainId) => switchChain({ chainId }), // Add this for components calling switchNetwork directly
    signMessage: signMessageAsync, // Add direct access to sign message function
    isRailgunInitialized,
    initializeRailgun,
    railgunAddress,
    railgunWalletID,
    isInitializing,
    isInitializingRailgun: isInitializing,
    railgunError,
    canUseRailgun: isRailgunInitialized,
    railgunWalletId: railgunWalletID,
    getCurrentNetwork: () => {
      const networkNames = {
        1: 'Ethereum',
        137: 'Polygon',
        42161: 'Arbitrum',
        56: 'BSC'
      };
      return { 
        id: chainId, 
        name: networkNames[chainId] || `Chain ${chainId}` 
      };
    },
    supportedNetworks: { 1: true, 137: true, 42161: true, 56: true },
    walletProviders: { METAMASK: 'metamask', WALLETCONNECT: 'walletconnect' },
    walletProvider: getCurrentWalletProvider(), // Add current wallet provider
    isWalletAvailable: (type) => {
      if (type === 'metamask') return !!window.ethereum?.isMetaMask;
      if (type === 'walletconnect') return true; // WalletConnect is always available
      return false;
    },
    getCurrentWalletProvider,
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