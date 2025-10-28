/**
 * Environment Configuration for Lexie Wallet
 * Handles all environment variables and provides defaults
 */

// Prefer serverless proxy to avoid exposing keys. Use absolute URL so ethers providers accept it.
// TEMPORARY: Always use production URLs until staging API keys are configured.
const buildProxyUrl = (chainId, provider = "alchemy") => {
  return `https://www.lexiecrypto.com/api/rpc?chainId=${chainId}&provider=${provider}`;
};

// Alchemy RPC URLs with proper API key integration
export const RPC_URLS = {
  // Route browser RPC calls via Vercel proxy. The proxy will use server-stored keys and fallback to Ankr.
  ethereum: buildProxyUrl(1, "auto"),
  polygon: buildProxyUrl(137, "auto"),
  arbitrum: buildProxyUrl(42161, "auto"),
  bsc: buildProxyUrl(56, "auto"),
};

// Railgun Configuration
export const RAILGUN_CONFIG = {
  dbName: import.meta.env.VITE_RAILGUN_DB_NAME || "railgun-engine-db",
  walletSourceName: import.meta.env.VITE_WALLET_SOURCE_NAME || "lexiewallet",
  debug: import.meta.env.VITE_RAILGUN_DEBUG === "true",
  useNativeArtifacts: false, // Always false for web
  skipMerkletreeScans: false, // We want to scan balances
  verboseScanLogging: import.meta.env.VITE_RAILGUN_DEBUG === "true",
};

// POI (Proof of Innocence) Configuration
export const POI_CONFIG = {
  aggregatorUrls: import.meta.env.VITE_POI_AGGREGATOR_URL
    ? [import.meta.env.VITE_POI_AGGREGATOR_URL]
    : ["https://ppoi.fdi.network/"], // Default to valid POI URL from RAILGUN Discord
  customPOILists: [], // Can be expanded later
};

// WalletConnect Configuration (ReOwn) - PRODUCTION READY
const walletConnectProjectId =
  import.meta.env.VITE_REOWN_PROJECT_ID ||
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

// Validate required WalletConnect configuration
if (!walletConnectProjectId && APP_CONFIG.isProduction) {
  throw new Error(
    "VITE_REOWN_PROJECT_ID or VITE_WALLETCONNECT_PROJECT_ID environment variable is required for production"
  );
} else if (!walletConnectProjectId) {
  console.warn(
    "⚠️ WalletConnect project ID not set - using demo fallback for development"
  );
}

export const WALLETCONNECT_CONFIG = {
  projectId: walletConnectProjectId || "demo-project-id",
  metadata: {
    name: import.meta.env.VITE_APP_NAME || "Lexie AI Wallet",
    description: "AI-powered Web3 wallet with privacy features",
    url: window.location.origin,
    icons: [`${window.location.origin}/lexie.png`],
  },
};

// PostHog Configuration
export const POSTHOG_CONFIG = {
  apiKey: import.meta.env.VITE_PUBLIC_POSTHOG_KEY || "",
  options: {
    api_host:
      import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://app.posthog.com",
    defaults: "2025-05-24",
  },
};

// Network Configuration
export const NETWORK_CONFIG = {
  environment: import.meta.env.VITE_NETWORK_ENV || "mainnet",
  defaultChainId: 1, // Ethereum mainnet
  supportedChainIds: [1, 137, 42161, 10, 56], // Ethereum, Polygon, Arbitrum, Optimism, BSC
};

// Application Configuration
export const APP_CONFIG = {
  name: import.meta.env.VITE_APP_NAME || "Lexie AI Wallet",
  version: import.meta.env.VITE_APP_VERSION || "1.0.0",
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
};

// Validation function to check required environment variables
export const validateEnvironment = () => {
  const requiredVars = [];
  const missingVars = [];

  // Check if we're in production and require real API keys
  if (APP_CONFIG.isProduction) {
    // No client-side Alchemy key required anymore (RPC goes through /api/rpc)
    // Keep WalletConnect ID optional: warn but don't crash if absent
    if (
      import.meta.env.VITE_REOWN_PROJECT_ID ||
      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
    ) {
      // present → fine
    } else {
      console.warn(
        "WalletConnect project ID is not set. Add VITE_REOWN_PROJECT_ID or VITE_WALLETCONNECT_PROJECT_ID for production."
      );
    }
  }

  // Nothing mandatory for client now; keep hook for future checks

  if (missingVars.length > 0) {
    console.warn("Missing required environment variables:", missingVars);
    if (APP_CONFIG.isProduction) {
      throw new Error(
        `Missing required environment variables: ${missingVars.join(", ")}`
      );
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
  POSTHOG_CONFIG,
  NETWORK_CONFIG,
  APP_CONFIG,
  validateEnvironment,
};
