// utils/tokens.ts
export const getTokenAddress = (t?: any) =>
  (t?.tokenAddress ?? t?.address ?? '').toLowerCase() || null;

export const getTokenKey = (token?: any) => {
  const addr = getTokenAddress(token);
  return addr || token?.symbol || 'unknown';
};

export const areTokensEqual = (t1?: any, t2?: any) => {
  const addr1 = getTokenAddress(t1);
  const addr2 = getTokenAddress(t2);

  // If both have addresses, compare addresses
  if (addr1 && addr2) {
    return addr1 === addr2;
  }

  // If both are native tokens (no address), compare symbols
  if (!addr1 && !addr2) {
    return (t1?.symbol || '').toLowerCase() === (t2?.symbol || '').toLowerCase();
  }

  // Different types (one has address, one doesn't)
  return false;
};

// Check if a token is a native token for a given chain
export const isNativeTokenForChain = (tokenSymbol?: string, chainId?: number) => {
  if (!tokenSymbol || !chainId) return false;

  const nativeTokensByChain = {
    1: ['ETH'], // Ethereum
    42161: ['ETH'], // Arbitrum
    137: ['MATIC'], // Polygon
    56: ['BNB'], // BSC
  };

  const chainNativeTokens = nativeTokensByChain[chainId] || [];
  return chainNativeTokens.includes(tokenSymbol.toUpperCase());
};

// Check if a token address is valid (either has an address or is a native token for the chain)
export const isValidTokenForChain = (token?: any, chainId?: number) => {
  if (!token || !chainId) return false;

  const tokenAddr = getTokenAddress(token);
  // If token has an address, it's valid
  if (tokenAddr) return true;

  // If token has no address, check if it's a native token for this chain
  return isNativeTokenForChain(token.symbol, chainId);
};
