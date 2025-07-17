/**
 * Wallet Context
 * Manages external wallet connections (MetaMask, WalletConnect) and Railgun integration
 */

import React, { createContext, useContext, useReducer, useEffect, useCallback } from 'react';
import { createConfig, http, connect, disconnect, getAccount, getChainId, switchChain } from '@wagmi/core';
import { mainnet, polygon, arbitrum, optimism, bsc, sepolia } from '@wagmi/core/chains';
import { injected, walletConnect } from '@wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setSelectedRailgunWallet } from '@railgun-community/wallet';

import { initializeRailgunEngine, loadAllNetworkProviders, getEngineStatus, waitForRailgunReady } from '../utils/railgun/engine.js';
import { deriveRailgunWalletFromAddress, loadCachedRailgunWallet, clearCachedRailgunWallet } from '../utils/railgun/wallet.js';
import { WALLETCONNECT_CONFIG, RPC_URLS, NETWORK_CONFIG } from '../config/environment.js';

// Initial state
const initialState = {
  // External wallet state
  isConnected: false,
  address: null,
  chainId: null,
  connector: null,
  
  // Railgun engine state
  isRailgunInitialized: false,
  railgunEngineStatus: null,
  
  // Railgun wallet state
  railgunWalletId: null,
  railgunAddress: null,
  isRailgunWalletLoaded: false,
  
  // UI state
  isConnecting: false,
  isInitializingRailgun: false,
  
  // Error states
  connectionError: null,
  railgunError: null,
};

// Action types
const actionTypes = {
  SET_CONNECTING: 'SET_CONNECTING',
  SET_CONNECTED: 'SET_CONNECTED',
  SET_DISCONNECTED: 'SET_DISCONNECTED',
  SET_CHAIN_ID: 'SET_CHAIN_ID',
  SET_CONNECTION_ERROR: 'SET_CONNECTION_ERROR',
  
  SET_RAILGUN_INITIALIZING: 'SET_RAILGUN_INITIALIZING',
  SET_RAILGUN_INITIALIZED: 'SET_RAILGUN_INITIALIZED',
  SET_RAILGUN_ERROR: 'SET_RAILGUN_ERROR',
  UPDATE_RAILGUN_STATUS: 'UPDATE_RAILGUN_STATUS',
  
  SET_RAILGUN_WALLET: 'SET_RAILGUN_WALLET',
  CLEAR_RAILGUN_WALLET: 'CLEAR_RAILGUN_WALLET',
  
  CLEAR_ERRORS: 'CLEAR_ERRORS',
};

// Reducer
const walletReducer = (state, action) => {
  switch (action.type) {
    case actionTypes.SET_CONNECTING:
      return {
        ...state,
        isConnecting: action.payload,
        connectionError: action.payload ? null : state.connectionError,
      };
      
    case actionTypes.SET_CONNECTED:
      return {
        ...state,
        isConnected: true,
        isConnecting: false,
        address: action.payload.address,
        chainId: action.payload.chainId,
        connector: action.payload.connector,
        connectionError: null,
      };
      
    case actionTypes.SET_DISCONNECTED:
      return {
        ...state,
        isConnected: false,
        isConnecting: false,
        address: null,
        chainId: null,
        connector: null,
        connectionError: null,
      };
      
    case actionTypes.SET_CHAIN_ID:
      return {
        ...state,
        chainId: action.payload,
      };
      
    case actionTypes.SET_CONNECTION_ERROR:
      return {
        ...state,
        isConnecting: false,
        connectionError: action.payload,
      };
      
    case actionTypes.SET_RAILGUN_INITIALIZING:
      return {
        ...state,
        isInitializingRailgun: action.payload,
        railgunError: action.payload ? null : state.railgunError,
      };
      
    case actionTypes.SET_RAILGUN_INITIALIZED:
      return {
        ...state,
        isRailgunInitialized: action.payload,
        isInitializingRailgun: false,
        railgunError: null,
      };
      
    case actionTypes.SET_RAILGUN_ERROR:
      return {
        ...state,
        isInitializingRailgun: false,
        railgunError: action.payload,
      };
      
    case actionTypes.UPDATE_RAILGUN_STATUS:
      return {
        ...state,
        railgunEngineStatus: action.payload,
      };
      
    case actionTypes.SET_RAILGUN_WALLET:
      return {
        ...state,
        railgunWalletId: action.payload.walletId,
        railgunAddress: action.payload.address,
        isRailgunWalletLoaded: true,
      };
      
    case actionTypes.CLEAR_RAILGUN_WALLET:
      return {
        ...state,
        railgunWalletId: null,
        railgunAddress: null,
        isRailgunWalletLoaded: false,
      };
      
    case actionTypes.CLEAR_ERRORS:
      return {
        ...state,
        connectionError: null,
        railgunError: null,
      };
      
    default:
      return state;
  }
};

// Create context
const WalletContext = createContext();

// Wagmi configuration
const queryClient = new QueryClient();

const config = createConfig({
  chains: [mainnet, polygon, arbitrum, optimism, bsc, sepolia],
  connectors: [
    injected(),
    walletConnect({
      projectId: WALLETCONNECT_CONFIG.projectId,
      metadata: WALLETCONNECT_CONFIG.metadata,
    }),
  ],
  transports: {
    [mainnet.id]: http(RPC_URLS.ethereum),
    [polygon.id]: http(RPC_URLS.polygon),
    [arbitrum.id]: http(RPC_URLS.arbitrum),
    [optimism.id]: http(RPC_URLS.optimism),
    [bsc.id]: http(RPC_URLS.bsc),
    [sepolia.id]: http(RPC_URLS.sepolia),
  },
});

// Provider component
export const WalletProvider = ({ children }) => {
  const [state, dispatch] = useReducer(walletReducer, initialState);

  // Initialize Railgun engine on mount
  useEffect(() => {
    const initRailgun = async () => {
      dispatch({ type: actionTypes.SET_RAILGUN_INITIALIZING, payload: true });
      
      try {
        console.log('[WalletContext] Initializing Railgun engine...');
        
        // Initialize the engine
        await initializeRailgunEngine();
        
        // Load network providers
        const results = await loadAllNetworkProviders();
        console.log('[WalletContext] Network providers loaded:', results);
        
        // Update status
        const status = getEngineStatus();
        dispatch({ type: actionTypes.UPDATE_RAILGUN_STATUS, payload: status });
        dispatch({ type: actionTypes.SET_RAILGUN_INITIALIZED, payload: true });
        
        console.log('[WalletContext] Railgun engine initialized successfully');
      } catch (error) {
        console.error('[WalletContext] Failed to initialize Railgun:', error);
        dispatch({ type: actionTypes.SET_RAILGUN_ERROR, payload: error.message });
      }
    };
    
    initRailgun();
  }, []);

  // Connect to external wallet
  const connectWallet = useCallback(async (connectorType = 'injected') => {
    dispatch({ type: actionTypes.SET_CONNECTING, payload: true });
    
    try {
      const connector = connectorType === 'walletconnect' 
        ? walletConnect({ projectId: WALLETCONNECT_CONFIG.projectId })
        : injected();
        
      const result = await connect(config, { connector });
      
      const account = getAccount(config);
      const chainId = getChainId(config);
      
      dispatch({
        type: actionTypes.SET_CONNECTED,
        payload: {
          address: account.address,
          chainId,
          connector: result.connector,
        },
      });
      
      console.log('[WalletContext] External wallet connected:', {
        address: account.address,
        chainId,
        connector: connectorType,
      });

      // Automatically derive and cache Railgun wallet
      if (account.address && chainId) {
        await deriveAndSetupRailgunWallet(account.address, chainId);
      }
      
    } catch (error) {
      console.error('[WalletContext] Failed to connect wallet:', error);
      dispatch({ type: actionTypes.SET_CONNECTION_ERROR, payload: error.message });
    }
  }, []);

  // Derive and setup Railgun wallet for connected address
  const deriveAndSetupRailgunWallet = useCallback(async (userAddress, chainId) => {
    try {
      console.log('[WalletContext] Deriving Railgun wallet for connected address...');
      
      // Wait for Railgun engine to be ready
      await waitForRailgunReady();
      
      // Derive wallet from external wallet address
      const railgunWallet = await deriveRailgunWalletFromAddress(userAddress, chainId);
      
      // Set as selected wallet
      try {
        await setSelectedRailgunWallet(railgunWallet.walletID);
        console.log('[WalletContext] Railgun wallet set as selected:', railgunWallet.walletID);
      } catch (error) {
        console.warn('[WalletContext] Failed to set wallet as selected (non-critical):', error.message);
      }
      
      // Update context with Railgun wallet info
      dispatch({
        type: actionTypes.SET_RAILGUN_WALLET,
        payload: {
          walletId: railgunWallet.walletID,
          address: railgunWallet.railgunAddress,
        },
      });
      
      console.log('[WalletContext] Railgun wallet derived successfully:', {
        walletId: railgunWallet.walletID,
        address: railgunWallet.railgunAddress,
        isNew: railgunWallet.isNewWallet,
      });
      
      if (railgunWallet.isNewWallet) {
        console.log('[WalletContext] New Railgun wallet created and cached');
      } else {
        console.log('[WalletContext] Existing Railgun wallet loaded from cache');
      }
      
    } catch (error) {
      console.error('[WalletContext] Failed to derive Railgun wallet:', error);
      dispatch({ type: actionTypes.SET_RAILGUN_ERROR, payload: error.message });
    }
  }, []);

  // Load cached Railgun wallet on startup
  const loadCachedRailgunWalletOnStartup = useCallback(async (userAddress) => {
    if (!userAddress) return;
    
    try {
      console.log('[WalletContext] Loading cached Railgun wallet on startup...');
      
      // Wait for Railgun engine to be ready
      await waitForRailgunReady();
      
      const cachedWallet = await loadCachedRailgunWallet(userAddress);
      
      if (cachedWallet) {
        // Set as selected wallet
        try {
          await setSelectedRailgunWallet(cachedWallet.walletID);
          console.log('[WalletContext] Cached Railgun wallet set as selected:', cachedWallet.walletID);
        } catch (error) {
          console.warn('[WalletContext] Failed to set cached wallet as selected (non-critical):', error.message);
        }
        
        dispatch({
          type: actionTypes.SET_RAILGUN_WALLET,
          payload: {
            walletId: cachedWallet.walletID,
            address: cachedWallet.railgunAddress,
          },
        });
        
        console.log('[WalletContext] Cached Railgun wallet loaded successfully:', {
          walletId: cachedWallet.walletID,
          address: cachedWallet.railgunAddress,
        });
      } else {
        console.log('[WalletContext] No cached Railgun wallet found');
      }
    } catch (error) {
      console.warn('[WalletContext] Failed to load cached Railgun wallet:', error.message);
      // Don't set error state for cached wallet loading failures
    }
  }, []);

  // Disconnect wallet
  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect(config);
      dispatch({ type: actionTypes.SET_DISCONNECTED });
      dispatch({ type: actionTypes.CLEAR_RAILGUN_WALLET });
      console.log('[WalletContext] Wallet disconnected');
    } catch (error) {
      console.error('[WalletContext] Failed to disconnect wallet:', error);
    }
  }, []);

  // Switch network
  const switchNetwork = useCallback(async (targetChainId) => {
    if (!state.isConnected) {
      throw new Error('Wallet not connected');
    }
    
    try {
      await switchChain(config, { chainId: targetChainId });
      dispatch({ type: actionTypes.SET_CHAIN_ID, payload: targetChainId });
      console.log('[WalletContext] Switched to chain:', targetChainId);
    } catch (error) {
      console.error('[WalletContext] Failed to switch network:', error);
      throw error;
    }
  }, [state.isConnected]);

  // Set Railgun wallet
  const setRailgunWallet = useCallback((walletId, address) => {
    dispatch({
      type: actionTypes.SET_RAILGUN_WALLET,
      payload: { walletId, address },
    });
    console.log('[WalletContext] Railgun wallet set:', { walletId, address });
  }, []);

  // Clear Railgun wallet
  const clearRailgunWallet = useCallback(() => {
    dispatch({ type: actionTypes.CLEAR_RAILGUN_WALLET });
    console.log('[WalletContext] Railgun wallet cleared');
  }, []);

  // Clear errors
  const clearErrors = useCallback(() => {
    dispatch({ type: actionTypes.CLEAR_ERRORS });
  }, []);

  // Check if network is supported
  const isNetworkSupported = useCallback((chainId) => {
    return NETWORK_CONFIG.supportedChainIds.includes(chainId);
  }, []);

  // Get current network info
  const getCurrentNetwork = useCallback(() => {
    if (!state.chainId) return null;
    
    const networks = {
      1: { name: 'Ethereum', symbol: 'ETH' },
      137: { name: 'Polygon', symbol: 'MATIC' },
      42161: { name: 'Arbitrum', symbol: 'ETH' },
      10: { name: 'Optimism', symbol: 'ETH' },
      56: { name: 'BSC', symbol: 'BNB' },
      11155111: { name: 'Sepolia', symbol: 'ETH' },
    };
    
    return networks[state.chainId] || null;
  }, [state.chainId]);

  // Load cached wallet when Railgun is initialized and we have a connected address
  useEffect(() => {
    if (state.isRailgunInitialized && state.address && !state.railgunWalletId) {
      loadCachedRailgunWalletOnStartup(state.address);
    }
  }, [state.isRailgunInitialized, state.address, state.railgunWalletId, loadCachedRailgunWalletOnStartup]);

  // Context value
  const value = {
    // State
    ...state,
    
    // External wallet actions
    connectWallet,
    disconnectWallet,
    switchNetwork,
    
    // Railgun wallet actions
    setRailgunWallet,
    clearRailgunWallet,
    
    // Utility functions
    clearErrors,
    isNetworkSupported,
    getCurrentNetwork,
    
    // Computed values
    isReady: state.isConnected && state.isRailgunInitialized,
    canUseRailgun: state.isRailgunInitialized && !state.railgunError,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <WalletContext.Provider value={value}>
        {children}
      </WalletContext.Provider>
    </QueryClientProvider>
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