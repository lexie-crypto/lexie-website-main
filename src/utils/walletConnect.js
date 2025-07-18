/**
 * WalletConnect Integration using Reown AppKit
 * Provides wallet connection without browser extension dependency
 */

import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';

// Supported networks for Reown
const networks = [
  {
    id: 1,
    name: 'Ethereum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://eth.llamarpc.com'] } },
    blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } }
  },
  {
    id: 42161,
    name: 'Arbitrum',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: ['https://arb1.arbitrum.io/rpc'] } },
    blockExplorers: { default: { name: 'Arbiscan', url: 'https://arbiscan.io' } }
  },
  {
    id: 137,
    name: 'Polygon',
    nativeCurrency: { name: 'Matic', symbol: 'MATIC', decimals: 18 },
    rpcUrls: { default: { http: ['https://polygon-rpc.com'] } },
    blockExplorers: { default: { name: 'PolygonScan', url: 'https://polygonscan.com' } }
  },
  {
    id: 56,
    name: 'BNB Smart Chain',
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: { default: { http: ['https://bsc-dataseed.binance.org'] } },
    blockExplorers: { default: { name: 'BSCScan', url: 'https://bscscan.com' } }
  }
];

// Create ethers adapter
const ethersAdapter = new EthersAdapter();

// WalletConnect configuration
const walletConnectConfig = {
  adapters: [ethersAdapter],
  networks,
  projectId: import.meta.env.VITE_REOWN_PROJECT_ID || 'demo-project-id',
  metadata: {
    name: 'Lexie Crypto',
    description: 'AI-powered crypto trading with privacy features',
    url: 'https://lexiecrypto.com',
    icons: ['https://lexiecrypto.com/favicon.ico']
  },
  features: {
    analytics: false,
    email: false,
    socials: []
  }
};

let appKit = null;

// Initialize WalletConnect
export const initializeWalletConnect = () => {
  try {
    if (!appKit) {
      appKit = createAppKit(walletConnectConfig);
      console.log('[WalletConnect] Initialized AppKit');
    }
    return appKit;
  } catch (error) {
    console.error('[WalletConnect] Failed to initialize:', error);
    throw error;
  }
};

// Connect via WalletConnect
export const connectWalletConnect = async () => {
  try {
    if (!appKit) {
      throw new Error('WalletConnect not initialized');
    }

    // Open WalletConnect modal
    await appKit.open();
    
    // Wait for connection
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 60000); // 60 second timeout

      const unsubscribe = appKit.subscribeAccount((account) => {
        if (account.isConnected) {
          clearTimeout(timeout);
          unsubscribe();
          
          const provider = appKit.getWalletProvider();
          const address = account.address;
          const chainId = account.chainId;

          console.log('[WalletConnect] Connected:', { address, chainId });
          
          resolve({
            provider,
            address,
            chainId,
            isConnected: true
          });
        }
      });
    });
  } catch (error) {
    console.error('[WalletConnect] Connection failed:', error);
    throw error;
  }
};

// Disconnect WalletConnect
export const disconnectWalletConnect = async () => {
  try {
    if (appKit) {
      await appKit.disconnect();
      console.log('[WalletConnect] Disconnected');
    }
  } catch (error) {
    console.error('[WalletConnect] Disconnect failed:', error);
    throw error;
  }
};

// Get current WalletConnect state
export const getWalletConnectState = () => {
  if (!appKit) {
    return { isConnected: false };
  }

  const account = appKit.getAccount();
  return {
    isConnected: account.isConnected,
    address: account.address,
    chainId: account.chainId,
    provider: appKit.getWalletProvider()
  };
};

// Check if WalletConnect is available (always true since it's a protocol)
export const isWalletConnectAvailable = () => true;

export default {
  initializeWalletConnect,
  connectWalletConnect,
  disconnectWalletConnect,
  getWalletConnectState,
  isWalletConnectAvailable
}; 