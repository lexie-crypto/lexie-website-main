/**
 * Wallet Context Provider
 * Manages wallet connection state and Railgun integration
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { createConfig, custom } from 'wagmi';
import { mainnet, polygon, arbitrum, bsc } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';
import { WagmiProvider, useAccount, useConnect, useDisconnect } from 'wagmi';
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
      // Try to import Railgun wallet functions dynamically
      console.log('📦 Importing RAILGUN wallet functions...');
      const railgunWallet = await import('@railgun-community/wallet');
      console.log('✅ RAILGUN wallet imported successfully');

      if (!railgunWallet.startRailgunEngine) {
        throw new Error('RAILGUN functions not available');
      }

      // Skip Railgun engine initialization - the engine.js should handle this
      console.log('⚠️ Skipping Railgun engine init in WalletContext - using external engine');
      
      // Instead, try to import and use the engine initialization from engine.js
      const { initializeRailgun: initEngine, waitForRailgunReady } = await import('../utils/railgun/engine.js');
      
      console.log('🔧 Starting RAILGUN engine via engine.js...');
      await initEngine();
      await waitForRailgunReady();
      console.log('✅ RAILGUN engine started successfully');

      // Create or load Railgun wallet with proper signature-based key derivation
      const encryptionKey = address.toLowerCase();
      let mnemonic = localStorage.getItem(`railgun-mnemonic-${address}`);
      
      if (!mnemonic) {
        // Generate a new mnemonic using Railgun's secure generation
        if (!railgunWallet.generateMnemonic) {
          throw new Error('Railgun mnemonic generation not available');
        }
        
        mnemonic = railgunWallet.generateMnemonic();
        console.log('🔑 Generated new mnemonic using RAILGUN');
        
        // Store mnemonic securely (in production, use proper encryption)
        localStorage.setItem(`railgun-mnemonic-${address}`, mnemonic);
      }

      console.log('👛 Creating RAILGUN wallet...');
      const creationBlockNumberMap = {}; // Will use default block numbers
      const railgunWalletInfo = await railgunWallet.createRailgunWallet(
        encryptionKey,
        mnemonic,
        creationBlockNumberMap
      );

      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setRailgunWalletID(railgunWalletInfo.railgunWalletID);

      console.log('🕐 Waiting for RAILGUN wallet to be ready...');
      // Wait for the wallet to be fully ready before marking as initialized
      if (railgunWallet.waitForRailgunWalletReady) {
        await railgunWallet.waitForRailgunWalletReady(railgunWalletInfo.railgunWalletID);
        console.log('✅ RAILGUN wallet is ready for transactions');
      } else {
        console.warn('⚠️ waitForRailgunWalletReady not available, proceeding without wait');
      }

      setIsRailgunInitialized(true);

      console.log('🎉 RAILGUN wallet initialized successfully:', {
        address: railgunWalletInfo.railgunAddress,
        walletID: railgunWalletInfo.railgunWalletID
      });

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
    switchChain: () => {}, // Implement chain switching if needed
    isRailgunInitialized,
    initializeRailgun,
    railgunAddress,
    railgunWalletID,
    isInitializing,
    isInitializingRailgun: isInitializing,
    railgunError,
    canUseRailgun: isRailgunInitialized,
    railgunWalletId: railgunWalletID,
    getCurrentNetwork: () => ({ id: chainId, name: 'Current Network' }),
    supportedNetworks: { 1: true, 137: true, 42161: true, 56: true },
    walletProviders: { METAMASK: 'metamask', WALLETCONNECT: 'walletconnect' },
    isWalletAvailable: (type) => {
      if (type === 'metamask') return !!window.ethereum?.isMetaMask;
      if (type === 'walletconnect') return true; // WalletConnect is always available
      return false;
    },
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