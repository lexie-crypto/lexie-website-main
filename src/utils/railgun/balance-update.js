/**
 * RAILGUN Balance Update Service
 * Adapted from official SDK: wallet/src/services/railgun/wallets/balance-update.ts
 * 
 * Handles balance update callbacks and POI proof progress
 */

import {
  NETWORK_CONFIG,
  TXIDVersion,
  RailgunWalletBalanceBucket,
  isDefined,
  networkForChain,
} from '@railgun-community/shared-models';
import { getEngine } from './engine.js';
import { parseUnits, formatUnits } from 'ethers';

// Callback storage
let onBalanceUpdateCallback;
let onPOIProofProgressCallback;

/**
 * Set the balance update callback
 * @param {Function} callback - Callback function for balance updates
 */
export const setOnBalanceUpdateCallback = (callback) => {
  onBalanceUpdateCallback = callback;
};

/**
 * Set the POI proof progress callback
 * @param {Function} callback - Callback function for POI proof progress
 */
export const setOnWalletPOIProofProgressCallback = (callback) => {
  onPOIProofProgressCallback = callback;
};

/**
 * Parse RAILGUN token address to standard format
 * @param {string} tokenAddress - RAILGUN format token address
 * @returns {string} Standard format token address
 */
const parseRailgunTokenAddress = (tokenAddress) => {
  // RAILGUN uses a special format for token addresses
  // Convert from internal format to standard ERC20 address
  if (!tokenAddress || tokenAddress === '0x00') {
    return undefined; // Native token
  }
  
  // Remove 0x prefix if present and ensure lowercase
  const cleaned = tokenAddress.replace(/^0x/, '').toLowerCase();
  
  // RAILGUN internal addresses are 32 bytes, standard addresses are 20 bytes
  // Take the last 40 characters (20 bytes) for the actual address
  if (cleaned.length > 40) {
    return '0x' + cleaned.slice(-40);
  }
  
  return '0x' + cleaned.padStart(40, '0');
};

/**
 * Get serialized ERC20 balances from token balances
 * @param {Object} balances - Token balances from RAILGUN
 * @returns {Array} Array of ERC20 amounts
 */
export const getSerializedERC20Balances = (balances) => {
  const tokenHashes = Object.keys(balances);

  return tokenHashes
    .filter(tokenHash => {
      // Filter for ERC20 tokens (tokenType === 0)
      return balances[tokenHash].tokenData.tokenType === 0;
    })
    .map(railgunBalanceAddress => {
      const tokenAddress = parseRailgunTokenAddress(
        balances[railgunBalanceAddress].tokenData.tokenAddress
      );
      
      return {
        tokenAddress: tokenAddress?.toLowerCase(),
        amount: balances[railgunBalanceAddress].balance,
      };
    })
    .filter(item => item.tokenAddress !== undefined);
};

/**
 * Get NFT balances from token balances
 * @param {Object} balances - Token balances from RAILGUN
 * @returns {Array} Array of NFT amounts
 */
export const getNFTBalances = (balances) => {
  const tokenHashes = Object.keys(balances);

  return tokenHashes
    .filter(tokenHash => {
      // Filter for NFT tokens (tokenType === 1 or 2)
      const tokenType = balances[tokenHash].tokenData.tokenType;
      return tokenType === 1 || tokenType === 2;
    })
    .map(railgunBalanceAddress => {
      const tokenData = balances[railgunBalanceAddress].tokenData;
      const nftAddress = parseRailgunTokenAddress(tokenData.tokenAddress);
      
      return {
        nftAddress: nftAddress?.toLowerCase(),
        nftTokenType: tokenData.tokenType === 1 ? 'ERC721' : 'ERC1155',
        tokenSubID: tokenData.tokenSubID,
        amount: balances[railgunBalanceAddress].balance,
      };
    });
};

/**
 * Handle balance updates for a wallet
 * @param {string} txidVersion - TXID version
 * @param {Object} wallet - RAILGUN wallet instance
 * @param {Object} chain - Chain configuration
 */
export const onBalancesUpdate = async (txidVersion, wallet, chain) => {
  try {
    if (!onBalanceUpdateCallback) {
      return;
    }

    console.log(
      `[BalanceUpdate] Wallet balance SCANNED. Getting balances for chain ${chain.type}:${chain.id}.`
    );

    const network = networkForChain(chain);
    if (!network) {
      console.warn('[BalanceUpdate] Network not found for chain:', chain);
      return;
    }

    // Check if POI is required for this network
    const isPOIRequired = await checkPOIRequired(network.name);
    
    if (!isPOIRequired) {
      // POI not required - all balances are spendable
      return getAllBalancesAsSpendable(txidVersion, wallet, chain);
    }

    // POI required - get balances by bucket
    const tokenBalancesByBucket = await wallet.getTokenBalancesByBucket(
      txidVersion,
      chain
    );

    // Process each balance bucket
    const balanceBuckets = Object.values(RailgunWalletBalanceBucket);

    for (const balanceBucket of balanceBuckets) {
      if (!onBalanceUpdateCallback) {
        return;
      }

      const tokenBalances = tokenBalancesByBucket[balanceBucket];
      if (!isDefined(tokenBalances)) {
        continue;
      }

      const erc20Amounts = getSerializedERC20Balances(tokenBalances);
      const nftAmounts = getNFTBalances(tokenBalances);

      const balancesEvent = {
        txidVersion,
        chain,
        erc20Amounts,
        nftAmounts,
        railgunWalletID: wallet.id,
        balanceBucket,
      };

      // Call the callback
      onBalanceUpdateCallback(balancesEvent);
    }
  } catch (err) {
    console.error(
      `[BalanceUpdate] Error getting balances for chain ${chain.type}:${chain.id}:`,
      err
    );
  }
};

/**
 * Get all balances as spendable (for non-POI networks)
 * @param {string} txidVersion - TXID version
 * @param {Object} wallet - RAILGUN wallet instance
 * @param {Object} chain - Chain configuration
 */
const getAllBalancesAsSpendable = async (txidVersion, wallet, chain) => {
  if (!onBalanceUpdateCallback) {
    return;
  }

  const tokenBalances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    false // onlySpendable = false to get all balances
  );

  const erc20Amounts = getSerializedERC20Balances(tokenBalances);
  const nftAmounts = getNFTBalances(tokenBalances);

  const balancesEvent = {
    txidVersion,
    chain,
    erc20Amounts,
    nftAmounts,
    railgunWalletID: wallet.id,
    balanceBucket: RailgunWalletBalanceBucket.Spendable,
  };

  onBalanceUpdateCallback(balancesEvent);
};

/**
 * Check if POI is required for a network
 * @param {string} networkName - Network name
 * @returns {boolean} Whether POI is required
 */
const checkPOIRequired = async (networkName) => {
  try {
    // For now, POI is not required on testnets
    // In production, this would check the actual POI requirements
    const testnetNames = ['EthereumSepolia', 'PolygonMumbai', 'ArbitrumSepolia'];
    return !testnetNames.includes(networkName);
  } catch (error) {
    console.warn('[BalanceUpdate] Error checking POI requirements:', error);
    return false; // Default to not required if check fails
  }
};

/**
 * Handle POI proof progress updates
 * @param {string} status - POI proof status
 * @param {string} txidVersion - TXID version
 * @param {Object} wallet - RAILGUN wallet instance
 * @param {Object} chain - Chain configuration
 * @param {number} progress - Progress percentage
 * @param {string} listKey - POI list key
 * @param {string} txid - Transaction ID
 * @param {string} railgunTxid - RAILGUN transaction ID
 * @param {number} index - Current index
 * @param {number} totalCount - Total count
 * @param {string} errorMsg - Error message if any
 */
export const onWalletPOIProofProgress = (
  status,
  txidVersion,
  wallet,
  chain,
  progress,
  listKey,
  txid,
  railgunTxid,
  index,
  totalCount,
  errorMsg
) => {
  if (!onPOIProofProgressCallback) {
    return;
  }

  const progressEvent = {
    status,
    txidVersion,
    chain,
    railgunWalletID: wallet.id,
    progress,
    listKey,
    txid,
    railgunTxid,
    index,
    totalCount,
    errorMsg,
  };

  onPOIProofProgressCallback(progressEvent);
};

/**
 * Get balance for a specific ERC20 token
 * @param {string} txidVersion - TXID version
 * @param {Object} wallet - RAILGUN wallet instance
 * @param {string} networkName - Network name
 * @param {string} tokenAddress - Token address
 * @param {boolean} onlySpendable - Whether to only get spendable balance
 * @returns {bigint} Token balance
 */
export const balanceForERC20Token = async (
  txidVersion,
  wallet,
  networkName,
  tokenAddress,
  onlySpendable
) => {
  const { chain } = NETWORK_CONFIG[networkName];
  const balances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    onlySpendable
  );
  const tokenBalances = getSerializedERC20Balances(balances);

  const matchingTokenBalance = tokenBalances.find(
    tokenBalance =>
      tokenBalance.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
  );
  
  if (!matchingTokenBalance) {
    return 0n;
  }
  
  return matchingTokenBalance.amount;
};

/**
 * Get balance for a specific NFT
 * @param {string} txidVersion - TXID version
 * @param {Object} wallet - RAILGUN wallet instance
 * @param {string} networkName - Network name
 * @param {Object} nftTokenData - NFT token data
 * @param {boolean} onlySpendable - Whether to only get spendable balance
 * @returns {bigint} NFT balance
 */
export const balanceForNFT = async (
  txidVersion,
  wallet,
  networkName,
  nftTokenData,
  onlySpendable
) => {
  const { chain } = NETWORK_CONFIG[networkName];
  const balances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    onlySpendable
  );
  const nftBalances = getNFTBalances(balances);

  const matchingNFTBalance = nftBalances.find(
    nftBalance =>
      nftBalance.nftAddress.toLowerCase() === 
        nftTokenData.tokenAddress.toLowerCase() &&
      BigInt(nftBalance.tokenSubID) === BigInt(nftTokenData.tokenSubID)
  );
  
  if (!matchingNFTBalance) {
    return 0n;
  }
  
  return matchingNFTBalance.amount;
};

// Re-export token data helpers
export { getTokenDataERC20, getTokenDataNFT } from '@railgun-community/wallet'; 