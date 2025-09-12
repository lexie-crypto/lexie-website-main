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
