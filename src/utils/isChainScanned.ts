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

  const resp = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(addr)}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok) return null;

  const data = await resp.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];

  // Prefer exact walletId match, otherwise fallback to same-EOA key with signature (existing wallet)
  const key =
    keys.find((k: any) => k?.eoa?.toLowerCase?.() === addr && (!!walletId ? k?.walletId === walletId : true)) ??
    keys.find((k: any) => k?.eoa?.toLowerCase?.() === addr && (k?.signature || k?.encryptedMnemonic)) ??
    null;

  if (!key) return false;

  const scanned = Array.isArray(key.scannedChains)
    ? key.scannedChains.map((n: any) => Number(n)).filter(Number.isFinite)
    : [];

  const id = toNum(targetChainId);
  if (id == null) return null;

  return scanned.includes(id);
}
