/**
 * Environment Configuration for Lexie Wallet
 * Handles all environment variables and provides defaults
 */

// Helper function to build Alchemy URLs with API key
const buildAlchemyUrl = (baseUrl, apiKey = null) => {
  const key = apiKey || import.meta.env.VITE_ALCHEMY_API_KEY || 'demo';
  return baseUrl.replace('/v2/demo', `/v2/${key}`);
};

// Alchemy RPC URLs with proper API key integration
export const RPC_URLS = {
  ethereum: import.meta.env.VITE_ALCHEMY_ETHEREUM_URL || 
    buildAlchemyUrl('https://eth-mainnet.alchemyapi.io/v2/demo'),
  polygon: import.meta.env.VITE_ALCHEMY_POLYGON_URL || 
    buildAlchemyUrl('https://polygon-mainnet.alchemyapi.io/v2/demo'), 
  arbitrum: import.meta.env.VITE_ALCHEMY_ARBITRUM_URL || 
    buildAlchemyUrl('https://arb-mainnet.alchemyapi.io/v2/demo'),
  optimism: import.meta.env.VITE_ALCHEMY_OPTIMISM_URL || 
    buildAlchemyUrl('https://opt-mainnet.alchemyapi.io/v2/demo'),
  bsc: import.meta.env.VITE_ALCHEMY_BSC_URL || 
    buildAlchemyUrl('https://bnb-mainnet.g.alchemy.com/v2/demo'),
  
  // Testnets
  sepolia: import.meta.env.VITE_ALCHEMY_SEPOLIA_URL || 
    buildAlchemyUrl('https://eth-sepolia.alchemyapi.io/v2/demo'),
  mumbai: import.meta.env.VITE_ALCHEMY_POLYGON_MUMBAI_URL || 'https://rpc-mumbai.maticvigil.com',
};

// Railgun Configuration
export const RAILGUN_CONFIG = {
  dbName: import.meta.env.VITE_RAILGUN_DB_NAME || 'railgun-engine-db',
  walletSourceName: import.meta.env.VITE_WALLET_SOURCE_NAME || 'lexiewallet',
  debug: import.meta.env.VITE_RAILGUN_DEBUG === 'true',
  useNativeArtifacts: false, // Always false for web
  skipMerkletreeScans: false, // We want to scan balances
  verboseScanLogging: import.meta.env.VITE_RAILGUN_DEBUG === 'true',
};

// POI (Proof of Innocence) Configuration
export const POI_CONFIG = {
  aggregatorUrls: import.meta.env.VITE_POI_AGGREGATOR_URL 
    ? [import.meta.env.VITE_POI_AGGREGATOR_URL] 
    : [],
  customPOILists: [], // Can be expanded later
};

// WalletConnect Configuration (ReOwn)
export const WALLETCONNECT_CONFIG = {
  projectId: import.meta.env.VITE_REOWN_PROJECT_ID || 
    import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || '',
  metadata: {
    name: import.meta.env.VITE_APP_NAME || 'Lexie AI Wallet',
    description: 'AI-powered Web3 wallet with privacy features',
    url: window.location.origin,
    icons: [`${window.location.origin}/lexie.png`],
  },
};

// Network Configuration
export const NETWORK_CONFIG = {
  environment: import.meta.env.VITE_NETWORK_ENV || 'mainnet',
  defaultChainId: 1, // Ethereum mainnet
  supportedChainIds: [1, 137, 42161, 10, 56], // Ethereum, Polygon, Arbitrum, Optimism, BSC
};

// Application Configuration
export const APP_CONFIG = {
  name: import.meta.env.VITE_APP_NAME || 'Lexie AI Wallet',
  version: import.meta.env.VITE_APP_VERSION || '1.0.0',
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
};

// Validation function to check required environment variables
export const validateEnvironment = () => {
  const requiredVars = [];
  const missingVars = [];

  // Check if we're in production and require real API keys
  if (APP_CONFIG.isProduction) {
    requiredVars.push(
      'VITE_ALCHEMY_API_KEY',
      'VITE_REOWN_PROJECT_ID'
    );
  }

  requiredVars.forEach(varName => {
    if (!import.meta.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.warn('Missing required environment variables:', missingVars);
    if (APP_CONFIG.isProduction) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }
  }

  return missingVars.length === 0;
};

// Initialize environment validation
validateEnvironment();

export default {
  RPC_URLS,
  RAILGUN_CONFIG,
  POI_CONFIG,
  WALLETCONNECT_CONFIG,
  NETWORK_CONFIG,
  APP_CONFIG,
  validateEnvironment,
}; 