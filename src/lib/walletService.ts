// Wallet API configuration - using proxy endpoints for security
export const WALLET_API_ENDPOINTS = {
  storeWalletMetadata: '/api/store-wallet-metadata',     // Store wallet address to RAILGUN ID mapping
  getWalletMetadata: '/api/get-wallet-metadata',         // Get wallet metadata by address
  storePrivateBalances: '/api/store-private-balances',   // Store private RAILGUN balances
  getPrivateBalances: '/api/get-private-balances',       // Get private RAILGUN balances
  storePublicBalances: '/api/store-public-balances',     // Store public wallet balances
  getPublicBalances: '/api/get-public-balances',         // Get public wallet balances
};

// Wallet API response types
export interface WalletMetadataResponse {
  success: boolean;
  data?: {
    walletAddress: string;
    walletId: string;
    createdAt: number;
  };
  error?: string;
}

export interface BalanceData {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  numericBalance: number;
  usdValue?: number;
}

export interface BalanceResponse {
  success: boolean;
  data?: {
    balances: BalanceData[];
    updatedAt: number;
  };
  stored?: number;
  error?: string;
}

export interface ApiError {
  error: string;
  details?: string;
}

// Generate request ID for structured logging
function generateRequestId(): string {
  return Math.random().toString(36).substring(7);
}

// Wallet API service using secure proxy endpoints
export class WalletService {
  
  /**
   * Store wallet metadata (wallet address to RAILGUN ID mapping)
   * @param walletAddress - Public wallet address (0x...)
   * @param walletId - RAILGUN wallet ID  
   * @param railgunAddress - RAILGUN address
   * @returns Success status
   */
  static async storeWalletMetadata(walletAddress: string, walletId: string, railgunAddress: string): Promise<boolean> {
    const requestId = generateRequestId();
    console.log(`FAKE-${requestId}] 💾 Starting store wallet metadata request:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      walletId: walletId?.slice(0, 8) + '...',
      railgunAddress: railgunAddress?.slice(0, 8) + '...'
    });

    try {
      const apiUrl = WALLET_API_ENDPOINTS.storeWalletMetadata;
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const body = JSON.stringify({
        walletAddress,
        walletId,
        railgunAddress
      });

      console.log(`FAKE-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'POST',
        headers: Object.keys(headers),
        timestamp: Date.now()
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`FAKE-${requestId}] ❌ Store wallet metadata API error:`, result);
        throw new Error(result?.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`FAKE-${requestId}] ✅ Successfully stored wallet metadata:`, result);
      return true;

    } catch (error) {
      console.error(`FAKE-${requestId}] ❌ Failed to store wallet metadata:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress?.slice(0, 8) + '...',
        walletId: walletId?.slice(0, 8) + '...'
      });
      
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`FAKE-${requestId}] Store request timeout - continuing without storage`);
      }
      return false;
    }
  }

  /**
   * Get wallet metadata by address
   * @param walletAddress - Public wallet address (0x...)
   * @returns Wallet metadata or null if not found
   */
  static async getWalletMetadata(walletAddress: string): Promise<WalletMetadataResponse['data'] | null> {
    const requestId = generateRequestId();
    console.log(`FAKE-${requestId}] 📥 Starting get wallet metadata request:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...'
    });

    try {
      const apiUrl = `${WALLET_API_ENDPOINTS.getWalletMetadata}/${walletAddress}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      console.log(`FAKE-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'GET'
      });

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 404) {
        console.log(`FAKE-${requestId}] ℹ️ No wallet metadata found`);
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        console.error(`FAKE-${requestId}] ❌ Get wallet metadata API error:`, result);
        return null;
      }

      console.log(`FAKE-${requestId}] ✅ Retrieved wallet metadata`);
      return result.data;

    } catch (error) {
        console.error(`FAKE-${requestId}] ❌ Failed to retrieve wallet metadata:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress?.slice(0, 8) + '...'
      });
      
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`FAKE-${requestId}] Get request timeout`);
      }
      return null;
    }
  }

  /**
   * Store private RAILGUN balances
   * @param walletId - RAILGUN wallet ID
   * @param chainId - Blockchain chain ID
   * @param balances - Array of private balance objects
   * @returns Success status
   */
  static async storePrivateBalances(walletId: string, chainId: number, balances: BalanceData[]): Promise<boolean> {
    const requestId = generateRequestId();
    console.log(`FAKE-${requestId}] 💾 Starting store private balances request:`, {
      walletId: walletId?.slice(0, 8) + '...',
      chainId,
      balanceCount: balances?.length || 0
    });

    try {
      const apiUrl = WALLET_API_ENDPOINTS.storePrivateBalances;
      
      // Filter out zero balances to reduce storage
      const filteredBalances = balances.filter(balance => 
        balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
      );
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const body = JSON.stringify({
        walletId,
        chainId,
        balances: filteredBalances
      });

      console.log(`FAKE-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'POST',
        balanceCount: filteredBalances.length,
        headers: Object.keys(headers),
        timestamp: Date.now()
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`FAKE-${requestId}] ❌ Store private balances API error:`, result);
        throw new Error(result?.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`FAKE-${requestId}] ✅ Successfully stored private balances:`, result);
      return true;

    } catch (error) {
      console.error(`FAKE-${requestId}] ❌ Failed to store private balances:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletId: walletId?.slice(0, 8) + '...',
        chainId
      });
      
      // Return false instead of throwing - this is non-critical for UI
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`FAKE-${requestId}] Store request timeout - continuing without storage`);
      }
      return false;
    }
  }

  /**
   * Get private RAILGUN balances
   * @param walletId - RAILGUN wallet ID
   * @param chainId - Blockchain chain ID
   * @returns Private balance data or null if not found
   */
  static async getPrivateBalances(walletId: string, chainId: number): Promise<{ balances: BalanceData[]; updatedAt: number } | null> {
    const requestId = generateRequestId();
    console.log(`[WALLET-BALANCE-${requestId}] 📥 Starting get private balances request:`, {
      walletId: walletId?.slice(0, 8) + '...',
      chainId
    });

    try {
      const apiUrl = `${WALLET_API_ENDPOINTS.getPrivateBalances}/${walletId}-${chainId}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      console.log(`[WALLET-BALANCE-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'GET'
      });

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 404) {
        console.log(`[WALLET-BALANCE-${requestId}] ℹ️ No private balance data found`);
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        console.error(`[WALLET-BALANCE-${requestId}] ❌ Get private balances API error:`, result);
        return null;
      }

      const { balances, updatedAt } = result.data;

      console.log(`[WALLET-BALANCE-${requestId}] ✅ Retrieved private balance data:`, {
        balanceCount: balances?.length || 0,
        updatedAt: new Date(updatedAt).toISOString(),
        source: 'Backend Redis'
      });

      return { balances, updatedAt };

    } catch (error) {
      console.error(`[WALLET-BALANCE-${requestId}] ❌ Failed to retrieve private balance data:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletId: walletId?.slice(0, 8) + '...',
        chainId
      });
      
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`[WALLET-BALANCE-${requestId}] Get request timeout`);
      }
      return null;
    }
  }

  /**
   * Store public wallet balances
   * @param walletAddress - Public wallet address (0x...)
   * @param chainId - Blockchain chain ID
   * @param balances - Array of public balance objects
   * @returns Success status
   */
  static async storePublicBalances(walletAddress: string, chainId: number, balances: BalanceData[]): Promise<boolean> {
    const requestId = generateRequestId();
    console.log(`[WALLET-PUBLIC-${requestId}] 💾 Starting store public balances request:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      chainId,
      balanceCount: balances?.length || 0
    });

    try {
      const apiUrl = WALLET_API_ENDPOINTS.storePublicBalances;
      
      // Filter out zero balances to reduce storage
      const filteredBalances = balances.filter(balance => 
        balance && typeof balance.numericBalance === 'number' && balance.numericBalance > 0
      );
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      const body = JSON.stringify({
        walletAddress,
        chainId,
        balances: filteredBalances
      });

      console.log(`[WALLET-PUBLIC-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'POST',
        balanceCount: filteredBalances.length,
        headers: Object.keys(headers),
        timestamp: Date.now()
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(30000),
      });

      const result = await response.json();

      if (!response.ok) {
        console.error(`[WALLET-PUBLIC-${requestId}] ❌ Store public balances API error:`, result);
        throw new Error(result?.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`[WALLET-PUBLIC-${requestId}] ✅ Successfully stored public balances:`, result);
      return true;

    } catch (error) {
      console.error(`[WALLET-PUBLIC-${requestId}] ❌ Failed to store public balances:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress?.slice(0, 8) + '...',
        chainId
      });
      
      // Return false instead of throwing - this is non-critical for UI
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`[WALLET-PUBLIC-${requestId}] Store request timeout - continuing without storage`);
      }
      return false;
    }
  }

  /**
   * Get public wallet balances
   * @param walletAddress - Public wallet address (0x...)
   * @param chainId - Blockchain chain ID
   * @returns Public balance data or null if not found
   */
  static async getPublicBalances(walletAddress: string, chainId: number): Promise<{ balances: BalanceData[]; updatedAt: number } | null> {
    const requestId = generateRequestId();
    console.log(`[WALLET-PUBLIC-${requestId}] 📥 Starting get public balances request:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      chainId
    });

    try {
      const apiUrl = `${WALLET_API_ENDPOINTS.getPublicBalances}/${walletAddress}-${chainId}`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      console.log(`[WALLET-PUBLIC-${requestId}] 🚀 Calling proxy endpoint:`, {
        url: apiUrl,
        method: 'GET'
      });

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(30000),
      });

      if (response.status === 404) {
        console.log(`[WALLET-PUBLIC-${requestId}] ℹ️ No public balance data found`);
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        console.error(`[WALLET-PUBLIC-${requestId}] ❌ Get public balances API error:`, result);
        return null;
      }

      const { balances, updatedAt } = result.data;

      console.log(`[WALLET-PUBLIC-${requestId}] ✅ Retrieved public balance data:`, {
        balanceCount: balances?.length || 0,
        updatedAt: new Date(updatedAt).toISOString(),
        source: 'Backend Redis'
      });

      return { balances, updatedAt };

    } catch (error) {
      console.error(`[WALLET-PUBLIC-${requestId}] ❌ Failed to retrieve public balance data:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress?.slice(0, 8) + '...',
        chainId
      });
      
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`[WALLET-PUBLIC-${requestId}] Get request timeout`);
      }
      return null;
    }
  }

  /**
   * Helper method to check if cached balance data is still fresh
   * @param updatedAt - Timestamp when data was last updated
   * @param maxAge - Maximum age in milliseconds (default: 5 minutes)
   * @returns True if data is still fresh
   */
  static isDataFresh(updatedAt: number, maxAge: number = 5 * 60 * 1000): boolean {
    const age = Date.now() - updatedAt;
    return age < maxAge;
  }

  /**
   * Bulk operation to store both wallet metadata and balances
   * @param walletAddress - Public wallet address (0x...)
   * @param walletId - RAILGUN wallet ID
   * @param railgunAddress - RAILGUN address
   * @param chainId - Blockchain chain ID
   * @param privateBalances - Array of private balance objects
   * @param publicBalances - Array of public balance objects
   * @returns Results of all storage operations
   */
  static async storeBulkWalletData(
    walletAddress: string, 
    walletId: string, 
    railgunAddress: string,
    chainId: number, 
    privateBalances: BalanceData[], 
    publicBalances: BalanceData[]
  ): Promise<{ metadataStored: boolean; privateStored: boolean; publicStored: boolean }> {
    const requestId = generateRequestId();
    console.log(`[WALLET-BULK-${requestId}] 💾 Starting bulk wallet data storage:`, {
      walletAddress: walletAddress?.slice(0, 8) + '...',
      walletId: walletId?.slice(0, 8) + '...',
      railgunAddress: railgunAddress?.slice(0, 8) + '...',
      chainId,
      privateCount: privateBalances?.length || 0,
      publicCount: publicBalances?.length || 0
    });

    // Execute all operations in parallel for better performance
    const [metadataStored, privateStored, publicStored] = await Promise.allSettled([
      this.storeWalletMetadata(walletAddress, walletId, railgunAddress),
      this.storePrivateBalances(walletId, chainId, privateBalances),
      this.storePublicBalances(walletAddress, chainId, publicBalances)
    ]);

    const results = {
      metadataStored: metadataStored.status === 'fulfilled' ? metadataStored.value : false,
      privateStored: privateStored.status === 'fulfilled' ? privateStored.value : false,
      publicStored: publicStored.status === 'fulfilled' ? publicStored.value : false
    };

    console.log(`[WALLET-BULK-${requestId}] ✅ Bulk storage completed:`, results);
    return results;
  }
}

// Legacy function exports for backward compatibility  
export async function storeWalletMetadata(walletAddress: string, walletId: string, railgunAddress: string): Promise<boolean> {
  return WalletService.storeWalletMetadata(walletAddress, walletId, railgunAddress);
}

export async function getWalletMetadata(walletAddress: string): Promise<WalletMetadataResponse['data'] | null> {
  return WalletService.getWalletMetadata(walletAddress);
}

export async function storePrivateBalances(walletId: string, chainId: number, balances: BalanceData[]): Promise<boolean> {
  return WalletService.storePrivateBalances(walletId, chainId, balances);
}

export async function getPrivateBalances(walletId: string, chainId: number): Promise<{ balances: BalanceData[]; updatedAt: number } | null> {
  return WalletService.getPrivateBalances(walletId, chainId);
}

export async function storePublicBalances(walletAddress: string, chainId: number, balances: BalanceData[]): Promise<boolean> {
  return WalletService.storePublicBalances(walletAddress, chainId, balances);
}

export async function getPublicBalances(walletAddress: string, chainId: number): Promise<{ balances: BalanceData[]; updatedAt: number } | null> {
  return WalletService.getPublicBalances(walletAddress, chainId);
}

// Default export
export default {
  WalletService,
  WALLET_API_ENDPOINTS,
  storeWalletMetadata,
  getWalletMetadata,
  storePrivateBalances,
  getPrivateBalances,
  storePublicBalances,
  getPublicBalances
}; 