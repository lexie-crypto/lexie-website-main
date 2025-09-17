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

  // Strict match: require eoa match, railgunAddress, signature/encryptedMnemonic, and walletId if provided
  const key = keys.find((k: any) => 
    k?.eoa?.toLowerCase?.() === addr &&
    k?.railgunAddress &&
    (k?.signature || k?.encryptedMnemonic) &&
    (walletId ? k?.walletId === walletId : true) // Require exact walletId if provided; allow if not
  ) || null;

  if (!key) return false; // No valid key → not scanned

  const scanned = Array.isArray(key.scannedChains)
    ? key.scannedChains.map((n: any) => Number(n)).filter(Number.isFinite)
    : [];

  const id = toNum(targetChainId);
  if (id == null) return null;

  return scanned.includes(id);
}
