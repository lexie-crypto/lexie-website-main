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

  console.log('[BalanceUpdate] 🔍 Processing balances for serialization:', {
    totalHashes: tokenHashes.length,
    sampleBalanceObjects: tokenHashes.slice(0, 3).map(hash => ({
      hash: hash.slice(0, 10) + '...',
      balance: balances[hash]?.balance,
      amount: balances[hash]?.amount,
      tokenType: balances[hash]?.tokenData?.tokenType,
      tokenAddress: balances[hash]?.tokenData?.tokenAddress?.slice(0, 10) + '...'
    }))
  });

  return tokenHashes
    .filter(tokenHash => {
      // Filter for ERC20 tokens (tokenType === 0)
      const isERC20 = balances[tokenHash].tokenData.tokenType === 0;
      console.log('[BalanceUpdate] Token filter check:', {
        hash: tokenHash.slice(0, 10) + '...',
        tokenType: balances[tokenHash].tokenData.tokenType,
        isERC20
      });
      return isERC20;
    })
    .map(railgunBalanceAddress => {
      const balanceObj = balances[railgunBalanceAddress];
      const tokenAddress = parseRailgunTokenAddress(
        balanceObj.tokenData.tokenAddress
      );
      
      // Try multiple ways to get the balance amount
      const balanceAmount = balanceObj.balance || balanceObj.amount || '0';
      
      console.log('[BalanceUpdate] 🔍 Serializing token balance:', {
        railgunAddress: railgunBalanceAddress.slice(0, 10) + '...',
        tokenAddress: tokenAddress?.slice(0, 10) + '...',
        rawBalanceObj: {
          balance: balanceObj.balance,
          amount: balanceObj.amount,
          tokenType: balanceObj.tokenData?.tokenType
        },
        finalAmount: balanceAmount
      });
      
      return {
        tokenAddress: tokenAddress?.toLowerCase() || null, // Use null for native tokens instead of undefined
        amount: balanceAmount,
      };
    });
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
  console.log('[BalanceUpdate] 🔥 onBalancesUpdate called!', {
    txidVersion,
    chain: chain?.id,
    walletID: wallet?.id?.slice(0, 8) + '...',
    hasCallback: !!onBalanceUpdateCallback
  });

  try {
    if (!onBalanceUpdateCallback) {
      console.warn('[BalanceUpdate] ⚠️ No balance update callback set in onBalancesUpdate!');
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

    // DEBUGGING: Let's see what the wallet object looks like
    console.log('[BalanceUpdate] 🔍 Wallet debug info:', {
      hasWallet: !!wallet,
      walletId: wallet?.id?.slice(0, 8) + '...',
      walletMethods: wallet ? Object.getOwnPropertyNames(Object.getPrototypeOf(wallet)) : []
    });

    // First try to get balances by bucket (POI-aware mode)
    let tokenBalancesByBucket;
    let usingPOIBuckets = false;
    
    try {
      console.log('[BalanceUpdate] Attempting to get balances by POI bucket...');
      tokenBalancesByBucket = await wallet.getTokenBalancesByBucket(
        txidVersion,
        chain
      );
      
      // Check if we got any spendable balances and analyze bucket distribution
      const spendableTokens = tokenBalancesByBucket[RailgunWalletBalanceBucket.Spendable] || {};
      const hasSpendableBalances = Object.keys(spendableTokens).length > 0;
      
      // Count balances in all buckets for diagnostic purposes
      const bucketCounts = {};
      Object.entries(tokenBalancesByBucket).forEach(([bucket, tokens]) => {
        bucketCounts[bucket] = Object.keys(tokens).length;
      });
      
      console.log(`[BalanceUpdate] POI bucket distribution:`, bucketCounts);
      console.log(`[BalanceUpdate] Spendable balances found: ${hasSpendableBalances}`);
      
      // If POI system gives us non-spendable balances only, this indicates POI issues
      // In this case, fall back to spendable-only mode for better user experience
      if (!hasSpendableBalances) {
        const totalBalances = Object.values(bucketCounts).reduce((sum, count) => sum + count, 0);
        console.warn(`[BalanceUpdate] ⚠️  POI system returned ${totalBalances} total balances but 0 spendable - falling back to spendable-only mode`);
        return getAllBalancesAsSpendable(txidVersion, wallet, chain);
      }
      
      usingPOIBuckets = true;
      
    } catch (error) {
      console.warn('[BalanceUpdate] POI bucket mode failed, falling back to spendable-only mode:', error);
      return getAllBalancesAsSpendable(txidVersion, wallet, chain);
    }

    // Process POI balance buckets
    console.log('[BalanceUpdate] ✅ Using POI bucket mode with spendable balances');
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
  console.log('[BalanceUpdate] getAllBalancesAsSpendable called', {
    txidVersion,
    chain: chain?.id,
    walletID: wallet?.id?.slice(0, 8) + '...',
    hasCallback: !!onBalanceUpdateCallback
  });

  if (!onBalanceUpdateCallback) {
    console.warn('[BalanceUpdate] No balance update callback set!');
    return;
  }

  try {
    const tokenBalances = await wallet.getTokenBalances(
      txidVersion,
      chain,
      false // onlySpendable = false to get all balances
    );

    console.log('[BalanceUpdate] 🔍 Raw token balances from SDK:', {
      count: Object.keys(tokenBalances).length,
      tokenKeys: Object.keys(tokenBalances),
      rawBalances: Object.entries(tokenBalances).reduce((acc, [key, value]) => {
        acc[key.slice(0, 10) + '...'] = {
          balance: value?.balance,
          amount: value?.amount, 
          tokenData: value?.tokenData ? {
            tokenAddress: value.tokenData.tokenAddress?.slice(0, 10) + '...',
            tokenType: value.tokenData.tokenType
          } : null
        };
        return acc;
      }, {})
    });

    // Let's also try getting spendable-only balances to compare
    const spendableTokenBalances = await wallet.getTokenBalances(
      txidVersion,
      chain,
      true // onlySpendable = true
    );

    console.log('[BalanceUpdate] 🔍 Spendable-only token balances from SDK:', {
      count: Object.keys(spendableTokenBalances).length,
      tokenKeys: Object.keys(spendableTokenBalances),
      rawSpendableBalances: Object.entries(spendableTokenBalances).reduce((acc, [key, value]) => {
        acc[key.slice(0, 10) + '...'] = {
          balance: value?.balance,
          amount: value?.amount,
          tokenData: value?.tokenData ? {
            tokenAddress: value.tokenData.tokenAddress?.slice(0, 10) + '...',
            tokenType: value.tokenData.tokenType
          } : null
        };
        return acc;
      }, {})
    });

    // Use spendable balances instead of all balances
    const erc20Amounts = getSerializedERC20Balances(spendableTokenBalances);
    const nftAmounts = getNFTBalances(spendableTokenBalances);

    console.log('[BalanceUpdate] Serialized balances (from spendable only):', {
      erc20Count: erc20Amounts.length,
      nftCount: nftAmounts.length,
      erc20Amounts
    });
    
    // Log warning if we have zero amounts (indicates timing issue)
    const zeroAmountTokens = erc20Amounts.filter(token => BigInt(token.amount || '0') === 0n);
    if (zeroAmountTokens.length > 0) {
      console.warn('[BalanceUpdate] ⚠️ SDK returned tokens with zero spendable amounts:', {
        zeroTokens: zeroAmountTokens.length,
        totalTokens: erc20Amounts.length,
        note: 'This suggests notes are decrypted but not yet processed for spending'
      });
    }

    const balancesEvent = {
      txidVersion,
      chain,
      erc20Amounts,
      nftAmounts,
      railgunWalletID: wallet.id,
      balanceBucket: RailgunWalletBalanceBucket.Spendable,
    };

    console.log('[BalanceUpdate] Calling balance update callback with event:', balancesEvent);
    onBalanceUpdateCallback(balancesEvent);
    console.log('[BalanceUpdate] Balance update callback completed');

  } catch (error) {
    console.error('[BalanceUpdate] Error in getAllBalancesAsSpendable:', error);
  }
};

/**
 * Check if POI is required for a network
 * @param {string} networkName - Network name
 * @returns {boolean} Whether POI is required
 */
const checkPOIRequired = async (networkName) => {
  try {
    // Use our proper POI service
    const { isPOIRequiredForNetwork, handlePOIError } = await import('./poi-service.js');
    
    const isRequired = await isPOIRequiredForNetwork(networkName);
    console.log(`[BalanceUpdate] ✅ POI required for ${networkName}: ${isRequired}`);
    
    return isRequired;
  } catch (error) {
    console.warn('[BalanceUpdate] POI check failed:', error);
    
    // Use POI error handler
    const { handlePOIError } = await import('./poi-service.js');
    const shouldContinue = handlePOIError(error, networkName);
    
    if (shouldContinue) {
      console.log(`[BalanceUpdate] 🔄 Continuing with spendable balances for ${networkName}`);
      return false; // Treat as not required so all balances are spendable
    }
    
    // Fallback for other errors
    return false;
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