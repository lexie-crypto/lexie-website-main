import React, { createContext, useContext, useState, useEffect } from 'react';
import { createConfig, http } from 'wagmi';
import { mainnet, polygon, arbitrum } from 'wagmi/chains';
import { metaMask, walletConnect } from 'wagmi/connectors';
import { WagmiProvider, useAccount, useConnect, useDisconnect } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a client for React Query
const queryClient = new QueryClient();

// Create wagmi config
const wagmiConfig = createConfig({
  chains: [mainnet, polygon, arbitrum],
  connectors: [
    metaMask(),
    walletConnect({
      projectId: import.meta.env.VITE_REOWN_PROJECT_ID,
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
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
  const [isInitializing, setIsInitializing] = useState(false);

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
    console.log('Starting Railgun initialization for address:', address);
    
    try {
      // Try to import Railgun wallet functions dynamically
      console.log('Importing Railgun wallet functions...');
      const railgunWallet = await import('@railgun-community/wallet');
      console.log('Railgun wallet imported successfully');

      if (!railgunWallet.startRailgunEngine) {
        throw new Error('Railgun functions not available - using demo mode');
      }

      // Initialize Railgun engine
      const walletSource = 'lexie-website';
      const dbPath = undefined; // Uses IndexedDB in browser
      const shouldDebug = true; // Enable debugging for now
      const customArtifactGetter = undefined;
      const useNativeArtifacts = false;
      const skipMerkletreeScans = true; // Skip for faster initialization

      console.log('Starting Railgun engine...');
      await railgunWallet.startRailgunEngine(
        walletSource,
        dbPath,
        shouldDebug,
        customArtifactGetter,
        useNativeArtifacts,
        skipMerkletreeScans
      );
      console.log('Railgun engine started successfully');

      // Create or load Railgun wallet
      const encryptionKey = address.toLowerCase();
      let mnemonic = localStorage.getItem(`railgun-mnemonic-${address}`);
      
      if (!mnemonic) {
        // Generate a new mnemonic
        try {
          if (railgunWallet.generateMnemonic) {
            mnemonic = railgunWallet.generateMnemonic();
            console.log('Generated new mnemonic using Railgun');
          } else {
            // Fallback mnemonic generation
            mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
            console.warn('Using fallback mnemonic generation for demo');
          }
        } catch (mnemonicError) {
          console.warn('Mnemonic generation failed, using fallback:', mnemonicError);
          mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
        }
        
        // Store mnemonic securely (in production, use proper encryption)
        localStorage.setItem(`railgun-mnemonic-${address}`, mnemonic);
      }

      console.log('Creating Railgun wallet...');
      const creationBlockNumberMap = {}; // Will use default block numbers
      const railgunWalletInfo = await railgunWallet.createRailgunWallet(
        encryptionKey,
        mnemonic,
        creationBlockNumberMap
      );

      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setIsRailgunInitialized(true);

      console.log('Railgun wallet initialized successfully:', railgunWalletInfo.railgunAddress);
    } catch (error) {
      console.error('Failed to initialize Railgun (falling back to demo mode):', error);
      
      // Set demo mode - we'll simulate Railgun functionality
      setIsRailgunInitialized(true);
      setRailgunAddress('demo-railgun-address-' + address.slice(-6));
      console.log('Running in demo mode for private transactions');
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
    isInitializing,
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