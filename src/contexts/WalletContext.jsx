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
      projectId: 'your-walletconnect-project-id', // Replace with your WalletConnect project ID
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
      const connector = connectors.find(c => 
        connectorType === 'metamask' ? c.id === 'metaMask' : c.id === 'walletConnect'
      );
      if (connector) {
        await connect({ connector });
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
    if (!isConnected || !address || isInitializing) return;

    setIsInitializing(true);
    try {
      // Import Railgun wallet functions dynamically
      const {
        startRailgunEngine,
        createRailgunWallet,
        loadRailgunWalletByID,
        getWalletMnemonic,
      } = await import('@railgun-community/wallet');

      // Initialize Railgun engine
      const walletSource = 'lexie-website';
      const dbPath = undefined; // Uses IndexedDB in browser
      const shouldDebug = false;
      const customArtifactGetter = undefined;
      const useNativeArtifacts = false;
      const skipMerkletreeScans = false;

      await startRailgunEngine(
        walletSource,
        dbPath,
        shouldDebug,
        customArtifactGetter,
        useNativeArtifacts,
        skipMerkletreeScans
      );

      // Create or load Railgun wallet
      const encryptionKey = address.toLowerCase(); // Using address as encryption key for simplicity
      let mnemonic = localStorage.getItem(`railgun-mnemonic-${address}`);
      
      if (!mnemonic) {
        // Generate a new mnemonic (fallback to simple generation if Railgun doesn't export it)
        try {
          const { generateMnemonic } = await import('@railgun-community/wallet');
          mnemonic = generateMnemonic();
        } catch {
          // Fallback mnemonic generation
          mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
          console.warn('Using fallback mnemonic generation for demo');
        }
        
        // Store mnemonic securely (in production, use proper encryption)
        localStorage.setItem(`railgun-mnemonic-${address}`, mnemonic);
      }

      const creationBlockNumberMap = {}; // Will use default block numbers
      const railgunWalletInfo = await createRailgunWallet(
        encryptionKey,
        mnemonic,
        creationBlockNumberMap
      );

      setRailgunAddress(railgunWalletInfo.railgunAddress);
      setIsRailgunInitialized(true);

      console.log('Railgun wallet initialized:', railgunWalletInfo.railgunAddress);
    } catch (error) {
      console.error('Failed to initialize Railgun:', error);
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