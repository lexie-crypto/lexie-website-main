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

  // Railgun state
  const [railgunWalletId, setRailgunWalletId] = useState(null);
  const [railgunAddress, setRailgunAddress] = useState(null);
  const [canUseRailgun, setCanUseRailgun] = useState(false);
  const [isRailgunInitialized, setIsRailgunInitialized] = useState(false);

  // Initialize Railgun when component mounts
  useEffect(() => {
    const setupRailgun = async () => {
      try {
        console.log('[WalletContext] Initializing Railgun...');
        await initializeRailgun();
        setIsRailgunInitialized(true);
        console.log('[WalletContext] Railgun initialized successfully');
      } catch (error) {
        console.error('[WalletContext] Failed to initialize Railgun:', error);
        toast.error('Failed to initialize privacy system');
      }
    };

    setupRailgun();
  }, []);

  // Check if current network is supported
  const getCurrentNetwork = useCallback(() => {
    return SUPPORTED_NETWORKS[chainId] || null;
  }, [chainId]);

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

  // Connect wallet function
  const connectWallet = useCallback(async () => {
    if (isConnecting) return;

    setIsConnecting(true);
    try {
      // Check if window.ethereum exists
      if (!window.ethereum) {
        throw new Error('Please install MetaMask or another Web3 wallet');
      }

      console.log('[WalletContext] Connecting wallet...');

      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Get chain ID
      const chainId = await window.ethereum.request({
        method: 'eth_chainId',
      });

      const userAddress = accounts[0];
      const chainIdNumber = parseInt(chainId, 16);

      console.log('[WalletContext] Wallet connected:', {
        address: userAddress,
        chainId: chainIdNumber,
      });

      // Update state
      setAddress(userAddress);
      setChainId(chainIdNumber);
      setIsConnected(true);

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
      toast.error(error.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, setupRailgunWallet]);

  // Disconnect wallet function
  const disconnectWallet = useCallback(() => {
    console.log('[WalletContext] Disconnecting wallet...');
    
    setIsConnected(false);
    setAddress(null);
    setChainId(null);
    setRailgunWalletId(null);
    setRailgunAddress(null);
    setCanUseRailgun(false);

    toast.success('Wallet disconnected');
  }, []);

  // Switch network function
  const switchNetwork = useCallback(async (targetChainId) => {
    try {
      const chainIdHex = `0x${targetChainId.toString(16)}`;
      
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });

      console.log('[WalletContext] Network switched to:', targetChainId);
      
    } catch (error) {
      console.error('[WalletContext] Failed to switch network:', error);
      toast.error('Failed to switch network');
      throw error;
    }
  }, []);

  // Listen for account and network changes
  useEffect(() => {
    if (!window.ethereum) return;

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

    // Add event listeners
    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Check if already connected
    const checkConnection = async () => {
      try {
        const accounts = await window.ethereum.request({
          method: 'eth_accounts',
        });
        
        if (accounts.length > 0) {
          const chainId = await window.ethereum.request({
            method: 'eth_chainId',
          });
          
          const chainIdNumber = parseInt(chainId, 16);
          
          setAddress(accounts[0]);
          setChainId(chainIdNumber);
          setIsConnected(true);

          // Setup Railgun if supported
          if (SUPPORTED_NETWORKS[chainIdNumber]) {
            setupRailgunWallet(accounts[0]).catch(console.error);
          }
        }
      } catch (error) {
        console.error('[WalletContext] Failed to check existing connection:', error);
      }
    };

    checkConnection();

    // Cleanup
    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [address, chainId, disconnectWallet, setupRailgunWallet]);

  // Context value
  const value = {
    // Connection state
    isConnected,
    address,
    chainId,
    isConnecting,

    // Railgun state
    railgunWalletId,
    railgunAddress,
    canUseRailgun,
    isRailgunInitialized,

    // Functions
    connectWallet,
    disconnectWallet,
    switchNetwork,
    getCurrentNetwork,
    setupRailgunWallet,

    // Utilities
    isValidRailgunAddress,
    supportedNetworks: SUPPORTED_NETWORKS,
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