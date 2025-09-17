export const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return v.startsWith('0x') ? parseInt(v, 16) : Number(v);
  if (typeof v === 'number') return v;
  return null;
};

export async function isChainScanned(
  eoa: string,
  walletId: string | null | undefined,
  targetChainId: number | string | bigint,
): Promise<boolean | null> {
  const addr = eoa?.toLowerCase?.();
  if (!addr) return null;

  let resp;
  try {
    resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(addr)}`, {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[isChainScanned] Fetch error:', e);
    return false; // Treat network errors as not scanned (trigger modal)
  }

  if (!resp.ok) {
    // Treat 404 or other errors as not scanned
    return false;
  }

  const data = await resp.json().catch(() => ({}));
  const keys = Array.isArray(data?.keys) ? data.keys : [];

  // Tolerant match: accept multiple field names and nested structures
  const key = keys.find((k: any) => {
    const keyAddrLower: string | undefined = (k?.eoa || k?.walletAddress || k?.address)?.toLowerCase?.();
    const keyWalletId: string | undefined = k?.walletId || k?.railgunWalletId;
    const hasAuth = !!k?.railgunAddress && (!!k?.signature || !!k?.encryptedMnemonic);
    const walletOk = walletId ? keyWalletId === walletId : true;
    return keyAddrLower === addr && hasAuth && walletOk;
  }) || null;

  if (!key) return false; // No valid key → not scanned

  const rawChains = Array.isArray(key?.scannedChains)
    ? key.scannedChains
    : (Array.isArray(key?.meta?.scannedChains) ? key.meta.scannedChains : []);

  const scanned = rawChains
    .map((n: any) => (typeof n === 'string' && n?.startsWith?.('0x') ? parseInt(n, 16) : Number(n)))
    .filter((n: any) => Number.isFinite(n));

  const id = toNum(targetChainId);
  if (id == null) return null;

  return scanned.includes(id);
}
