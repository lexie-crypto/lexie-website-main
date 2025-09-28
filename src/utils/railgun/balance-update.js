import {
  RailgunBalancesEvent,
  POIProofProgressEvent,
  RailgunNFTAmount,
  RailgunERC20Amount,
  NetworkName,
  NETWORK_CONFIG,
  TXIDVersion,
  NFTTokenType,
  RailgunWalletBalanceBucket,
  isDefined,
  networkForChain,
} from '@railgun-community/shared-models';
import { sendErrorMessage, sendMessage } from './logger.js';
// Utility functions
const parseRailgunTokenAddress = (tokenAddress) => {
  // Simple implementation - convert to standard address format
  if (typeof tokenAddress === 'string') {
    return tokenAddress;
  }
  // If it's a bytes array or other format, convert to hex string
  if (tokenAddress && tokenAddress.length) {
    return '0x' + Array.from(tokenAddress).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return tokenAddress;
};

// TokenType constants (replacing @railgun-community/engine import)
const TokenType = {
  ERC20: 0,
  ERC721: 1, 
  ERC1155: 2,
};

// Utility functions (simplified versions replacing @railgun-community/engine imports)
const getTokenDataHash = (tokenData) => {
  // Simple implementation for token data hashing
  return `${tokenData.tokenAddress}_${tokenData.tokenSubID || '0'}`;
};

const getTokenDataNFT = (tokenAddress, tokenSubID, nftTokenType) => {
  return {
    tokenAddress,
    tokenSubID,
    tokenType: nftTokenType,
  };
};

const getTokenDataERC20 = (tokenAddress) => {
  return {
    tokenAddress,
    tokenType: TokenType.ERC20,
  };
};

// Type placeholder for NFTTokenData (for JSDoc)
const NFTTokenData = {};

let onBalanceUpdateCallback;

export const setOnBalanceUpdateCallback = (callback) => {
  onBalanceUpdateCallback = callback;
};

let onWalletPOIProofProgressCallback;

export const setOnWalletPOIProofProgressCallback = (callback) => {
  onWalletPOIProofProgressCallback = callback;
};

export const getSerializedERC20Balances = (balances) => {
  const tokenHashes = Object.keys(balances);

  return tokenHashes
    .filter(tokenHash => {
      return balances[tokenHash].tokenData.tokenType === TokenType.ERC20;
    })
    .map(railgunBalanceAddress => {
      const erc20Balance = {
        tokenAddress: parseRailgunTokenAddress(
          balances[railgunBalanceAddress].tokenData.tokenAddress,
        ).toLowerCase(),
        amount: balances[railgunBalanceAddress].balance,
      };
      return erc20Balance;
    });
};

export const getSerializedNFTBalances = (balances) => {
  const tokenHashes = Object.keys(balances);

  return tokenHashes
    .filter(tokenHash => {
      return [TokenType.ERC721, TokenType.ERC1155].includes(
        balances[tokenHash].tokenData.tokenType,
      );
    })
    .map(railgunBalanceAddress => {
      const balanceForToken = balances[railgunBalanceAddress];
      const tokenData = balanceForToken.tokenData;
      const nftBalance = {
        nftAddress: parseRailgunTokenAddress(
          tokenData.tokenAddress,
        ).toLowerCase(),
        tokenSubID: tokenData.tokenSubID,
        nftTokenType: tokenData.tokenType,
        amount: balanceForToken.balance,
      };
      return nftBalance;
    });
};

const getNFTBalances = (balances) => {
  const tokenHashes = Object.keys(balances);

  return tokenHashes
    .filter(tokenHash => {
      return (
        [TokenType.ERC721, TokenType.ERC1155].includes(
          balances[tokenHash].tokenData.tokenType,
        ) && balances[tokenHash].balance > BigInt(0)
      );
    })
    .map(tokenHash => {
      const tokenData = balances[tokenHash].tokenData;

      const nftBalance = {
        nftAddress: parseRailgunTokenAddress(
          tokenData.tokenAddress,
        ).toLowerCase(),
        nftTokenType: tokenData.tokenType,
        tokenSubID: tokenData.tokenSubID,
        amount: balances[tokenHash].balance,
      };
      return nftBalance;
    });
};

export const onBalancesUpdate = async (txidVersion, wallet, chain) => {
  try {
    if (!onBalanceUpdateCallback) {
      return;
    }

    sendMessage(
      `Wallet balance SCANNED. Getting balances for chain ${chain.type}:${chain.id}.`,
    );

    const network = networkForChain(chain);
    if (!network) {
      return;
    }
    // Check if POI is required for this network (dynamic import to avoid circular dependencies)
    try {
      const { POIRequired } = await import('@railgun-community/wallet');
      if (!(await POIRequired.isRequiredForNetwork(network.name))) {
        // POI not required for this network
        return getAllBalancesAsSpendable(txidVersion, wallet, chain);
      }
    } catch (error) {
      console.warn('[BalanceUpdate] POI check failed, assuming POI required:', error.message);
      // Continue with POI-required flow as fallback
    }

    // POI required for this network
    const tokenBalancesByBucket = await wallet.getTokenBalancesByBucket(
      txidVersion,
      chain,
    );

    const balanceBuckets = Object.values(RailgunWalletBalanceBucket);

    balanceBuckets.forEach(balanceBucket => {
      if (!onBalanceUpdateCallback) {
        return;
      }

      const tokenBalances = tokenBalancesByBucket[balanceBucket];
      if (!isDefined(tokenBalances)) {
        return;
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

      onBalanceUpdateCallback(balancesEvent);
    });
  } catch (err) {
    if (!(err instanceof Error)) {
      return;
    }
    sendMessage(
      `Error getting balances for chain ${chain.type}:${chain.id}: ${err.message}`,
    );
    sendErrorMessage(err);
  }
};

const getAllBalancesAsSpendable = async (txidVersion, wallet, chain) => {
  if (!onBalanceUpdateCallback) {
    return;
  }

  const tokenBalances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    false, // onlySpendable
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
  errMessage,
) => {
  sendMessage(
    `[${listKey}, ${chain.type}:${chain.id}] Wallet POI proof progress: ${progress}.`,
  );
  if (!onWalletPOIProofProgressCallback) {
    return;
  }

  const poiProofEvent = {
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
    errMessage,
  };

  onWalletPOIProofProgressCallback(poiProofEvent);
};

export const balanceForERC20Token = async (
  txidVersion,
  wallet,
  networkName,
  tokenAddress,
  onlySpendable,
) => {
  const { chain } = NETWORK_CONFIG[networkName];
  const balances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    onlySpendable,
  );
  const tokenBalances = getSerializedERC20Balances(balances);

  const matchingTokenBalance = tokenBalances.find(
    tokenBalance =>
      tokenBalance.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
  );
  if (!matchingTokenBalance) {
    return 0n;
  }
  return matchingTokenBalance.amount;
};

export const balanceForNFT = async (
  txidVersion,
  wallet,
  networkName,
  nftTokenData,
  onlySpendable,
) => {
  const { chain } = NETWORK_CONFIG[networkName];
  const balances = await wallet.getTokenBalances(
    txidVersion,
    chain,
    onlySpendable,
  );
  const nftBalances = getSerializedNFTBalances(balances);

  const matchingNFTBalance = nftBalances.find(
    nftBalance =>
      nftBalance.nftAddress.toLowerCase() ===
        nftTokenData.tokenAddress.toLowerCase() &&
      BigInt(nftBalance.tokenSubID) === BigInt(nftTokenData.tokenSubID),
  );
  if (!matchingNFTBalance) {
    return 0n;
  }
  return matchingNFTBalance.amount;
};

export {
  getTokenDataHash,
  getTokenDataNFT,
  getTokenDataERC20,
  TokenType,
  NFTTokenType,
  NFTTokenData,
};
