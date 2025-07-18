/**
 * Wallet Context Provider
 * Manages wallet connection state and Railgun integration
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { initializeRailgun, isRailgunReady } from '../utils/railgun/engine';
import { 
  createWallet, 
  loadWallet, 
  deriveEncryptionKey,
  getCurrentWalletID,
  getCurrentWallet,
  isValidRailgunAddress,
} from '../utils/railgun/wallet';
import {
  initializeWalletConnect,
  connectWalletConnect,
  disconnectWalletConnect,
  getWalletConnectState,
  isWalletConnectAvailable,
} from '../utils/walletConnect';

// Wallet providers
const WALLET_PROVIDERS = {
  METAMASK: 'metamask',
  PHANTOM: 'phantom', 
  WALLETCONNECT: 'walletconnect',
};

// Create context
const WalletContext = createContext({});

// Supported networks
const SUPPORTED_NETWORKS = {
  1: { id: 1, name: 'Ethereum', type: 'ethereum' },
  42161: { id: 42161, name: 'Arbitrum', type: 'arbitrum' },
  137: { id: 137, name: 'Polygon', type: 'polygon' },
  56: { id: 56, name: 'BNB Smart Chain', type: 'bnb' },
};

export const WalletProvider = ({ children }) => {
  // Wallet connection state
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [walletProvider, setWalletProvider] = useState(null);
  const [connectionError, setConnectionError] = useState(null);

  // Railgun state
  const [railgunWalletId, setRailgunWalletId] = useState(null);
  const [railgunAddress, setRailgunAddress] = useState(null);
  const [canUseRailgun, setCanUseRailgun] = useState(false);
  const [isRailgunInitialized, setIsRailgunInitialized] = useState(false);
  const [isInitializingRailgun, setIsInitializingRailgun] = useState(false);
  const [railgunError, setRailgunError] = useState(null);

  // Initialize Railgun and WalletConnect when component mounts
  useEffect(() => {
    const setupRailgun = async () => {
      setIsInitializingRailgun(true);
      setRailgunError(null);
      try {
        console.log('[WalletContext] Initializing Railgun...');
        await initializeRailgun();
        setIsRailgunInitialized(true);
        console.log('[WalletContext] Railgun initialized successfully');
      } catch (error) {
        console.error('[WalletContext] Failed to initialize Railgun:', error);
        setRailgunError(error.message || 'Failed to initialize privacy system');
        toast.error('Failed to initialize privacy system');
      } finally {
        setIsInitializingRailgun(false);
      }
    };

    const setupWalletConnect = async () => {
      try {
        console.log('[WalletContext] Initializing WalletConnect...');
        await initializeWalletConnect();
        console.log('[WalletContext] WalletConnect initialized successfully');
      } catch (error) {
        console.error('[WalletContext] Failed to initialize WalletConnect:', error);
        // Don't show error toast for WalletConnect init, just log it
      }
    };

    setupRailgun();
    setupWalletConnect();
  }, []);

  // Check if current network is supported
  const getCurrentNetwork = useCallback(() => {
    return SUPPORTED_NETWORKS[chainId] || null;
  }, [chainId]);

  // Get wallet provider instance
  const getWalletProvider = useCallback((providerType) => {
    switch (providerType) {
      case WALLET_PROVIDERS.METAMASK:
        return window.ethereum && window.ethereum.isMetaMask ? window.ethereum : null;
      case WALLET_PROVIDERS.PHANTOM:
        return window.phantom && window.phantom.ethereum ? window.phantom.ethereum : null;
      case WALLET_PROVIDERS.WALLETCONNECT:
        // WalletConnect uses its own provider system, not window.ethereum
        const wcState = getWalletConnectState();
        return wcState.provider || null;
      default:
        return null;
    }
  }, []);

  // Check if a specific wallet is available
  const isWalletAvailable = useCallback((providerType) => {
    switch (providerType) {
      case WALLET_PROVIDERS.METAMASK:
        return !!(window.ethereum && window.ethereum.isMetaMask);
      case WALLET_PROVIDERS.PHANTOM:
        return !!(window.phantom && window.phantom.ethereum);
      case WALLET_PROVIDERS.WALLETCONNECT:
        return isWalletConnectAvailable(); // Always true since it's a protocol
      default:
        return false;
    }
  }, []);

  // Create or load Railgun wallet
  const setupRailgunWallet = useCallback(async (userAddress) => {
    try {
      if (!isRailgunInitialized) {
        throw new Error('Railgun not initialized');
      }

      console.log('[WalletContext] Setting up Railgun wallet...');

      // Generate encryption key (in production, this would use user signature)
      const encryptionKey = await deriveEncryptionKey('demo-signature', userAddress);

      // Try to load existing wallet first, or create new one
      let walletResult;
      const existingWalletId = getCurrentWalletID();
      
      if (existingWalletId) {
        console.log('[WalletContext] Loading existing Railgun wallet...');
        walletResult = await loadWallet(existingWalletId, encryptionKey);
      } else {
        console.log('[WalletContext] Creating new Railgun wallet...');
        walletResult = await createWallet(encryptionKey);
      }

      setRailgunWalletId(walletResult.walletID);
      setRailgunAddress(walletResult.railgunAddress);
      setCanUseRailgun(true);

      console.log('[WalletContext] Railgun wallet setup completed:', {
        walletID: walletResult.walletID?.slice(0, 8) + '...',
        railgunAddress: walletResult.railgunAddress?.slice(0, 10) + '...',
      });

      return walletResult;

    } catch (error) {
      console.error('[WalletContext] Failed to setup Railgun wallet:', error);
      setCanUseRailgun(false);
      throw error;
    }
  }, [isRailgunInitialized]);

  // Clear errors function
  const clearErrors = useCallback(() => {
    setConnectionError(null);
    setRailgunError(null);
  }, []);

  // Connect wallet function
  const connectWallet = useCallback(async (providerType) => {
    if (isConnecting) return;
    if (!providerType) {
      throw new Error('Please select a wallet provider');
    }

    setIsConnecting(true);
    setConnectionError(null);
    try {
      // Check if the selected wallet is available
      if (!isWalletAvailable(providerType)) {
        const walletNames = {
          [WALLET_PROVIDERS.METAMASK]: 'MetaMask',
          [WALLET_PROVIDERS.PHANTOM]: 'Phantom',
          [WALLET_PROVIDERS.WALLETCONNECT]: 'WalletConnect',
        };
        throw new Error(`Please install ${walletNames[providerType]} or select a different wallet`);
      }

      console.log('[WalletContext] Connecting wallet with provider:', providerType);

      let userAddress, chainIdNumber, provider;

      if (providerType === WALLET_PROVIDERS.WALLETCONNECT) {
        // Handle WalletConnect connection
        const wcResult = await connectWalletConnect();
        userAddress = wcResult.address;
        chainIdNumber = wcResult.chainId;
        provider = wcResult.provider;
      } else {
        // Handle browser extension wallets (MetaMask, Phantom)
        provider = getWalletProvider(providerType);
        if (!provider) {
          throw new Error('Wallet provider not available');
        }

        // Request account access
        const accounts = await provider.request({
          method: 'eth_requestAccounts',
        });

        if (accounts.length === 0) {
          throw new Error('No accounts found');
        }

        // Get chain ID
        const chainId = await provider.request({
          method: 'eth_chainId',
        });

        userAddress = accounts[0];
        chainIdNumber = parseInt(chainId, 16);
      }

      console.log('[WalletContext] Wallet connected:', {
        provider: providerType,
        address: userAddress,
        chainId: chainIdNumber,
      });

      // Update state
      setAddress(userAddress);
      setChainId(chainIdNumber);
      setIsConnected(true);
      setSelectedProvider(providerType);
      setWalletProvider(provider);

      // Setup Railgun wallet if network is supported
      if (SUPPORTED_NETWORKS[chainIdNumber]) {
        try {
          await setupRailgunWallet(userAddress);
          toast.success('Wallet connected with privacy features enabled');
        } catch (railgunError) {
          console.warn('[WalletContext] Railgun setup failed, continuing without privacy:', railgunError);
          toast.success('Wallet connected (privacy features unavailable)');
        }
      } else {
        toast.success('Wallet connected (unsupported network for privacy)');
      }

    } catch (error) {
      console.error('[WalletContext] Wallet connection failed:', error);
      const errorMessage = error.message || 'Failed to connect wallet';
      setConnectionError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, setupRailgunWallet, isWalletAvailable, getWalletProvider]);

  // Disconnect wallet function
  const disconnectWallet = useCallback(async () => {
    console.log('[WalletContext] Disconnecting wallet...');
    
    // Handle WalletConnect disconnection
    if (selectedProvider === WALLET_PROVIDERS.WALLETCONNECT) {
      try {
        await disconnectWalletConnect();
      } catch (error) {
        console.error('[WalletContext] Failed to disconnect WalletConnect:', error);
      }
    }
    
    setIsConnected(false);
    setAddress(null);
    setChainId(null);
    setSelectedProvider(null);
    setWalletProvider(null);
    setConnectionError(null);
    setRailgunWalletId(null);
    setRailgunAddress(null);
    setCanUseRailgun(false);
    setRailgunError(null);

    toast.success('Wallet disconnected');
  }, [selectedProvider]);

  // Switch network function
  const switchNetwork = useCallback(async (targetChainId) => {
    if (!walletProvider) {
      throw new Error('No wallet connected');
    }

    try {
      const chainIdHex = `0x${targetChainId.toString(16)}`;
      
      await walletProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });

      console.log('[WalletContext] Network switched to:', targetChainId);
      
    } catch (error) {
      console.error('[WalletContext] Failed to switch network:', error);
      toast.error('Failed to switch network');
      throw error;
    }
  }, [walletProvider]);

  // Listen for account and network changes only when a wallet is connected
  useEffect(() => {
    if (!walletProvider || !isConnected) return;

    const handleAccountsChanged = (accounts) => {
      console.log('[WalletContext] Accounts changed:', accounts);
      
      if (accounts.length === 0) {
        disconnectWallet();
      } else if (accounts[0] !== address) {
        // Account changed, reconnect
        setAddress(accounts[0]);
        if (SUPPORTED_NETWORKS[chainId]) {
          setupRailgunWallet(accounts[0]).catch(console.error);
        }
      }
    };

    const handleChainChanged = (chainId) => {
      const chainIdNumber = parseInt(chainId, 16);
      console.log('[WalletContext] Chain changed:', chainIdNumber);
      
      setChainId(chainIdNumber);
      
      // Reset Railgun state when chain changes
      setRailgunWalletId(null);
      setRailgunAddress(null);
      setCanUseRailgun(false);

      // Setup Railgun for new chain if supported
      if (address && SUPPORTED_NETWORKS[chainIdNumber]) {
        setupRailgunWallet(address).catch(console.error);
      }
    };

    // Add event listeners to the current provider
    walletProvider.on('accountsChanged', handleAccountsChanged);
    walletProvider.on('chainChanged', handleChainChanged);

    // Cleanup
    return () => {
      if (walletProvider.removeListener) {
        walletProvider.removeListener('accountsChanged', handleAccountsChanged);
        walletProvider.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [walletProvider, isConnected, address, chainId, disconnectWallet, setupRailgunWallet]);

  // Context value
  const value = {
    // Connection state
    isConnected,
    address,
    chainId,
    isConnecting,
    selectedProvider,
    walletProvider,
    connectionError,

    // Railgun state
    railgunWalletId,
    railgunAddress,
    canUseRailgun,
    isRailgunInitialized,
    isInitializingRailgun,
    railgunError,

    // Functions
    connectWallet,
    disconnectWallet,
    switchNetwork,
    getCurrentNetwork,
    setupRailgunWallet,
    isWalletAvailable,
    getWalletProvider,
    clearErrors,

    // Utilities
    isValidRailgunAddress,
    supportedNetworks: SUPPORTED_NETWORKS,
    walletProviders: WALLET_PROVIDERS,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};

// Hook to use wallet context
export const useWallet = () => {
  const context = useContext(WalletContext);
  
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  
  return context;
};

export default WalletContext; 