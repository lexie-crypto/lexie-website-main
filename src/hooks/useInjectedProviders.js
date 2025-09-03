/**
 * useInjectedProviders
 * Detects EIP-6963 announced providers and falls back to legacy injected providers.
 * ESM-only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

const pickProviderMeta = (provider, info) => {
  // Prefer EIP-6963 info
  const nameFromInfo = info?.name;
  const uuid = info?.uuid;
  const icon = info?.icon; // Data URI per EIP-6963 (optional)

  // Legacy flags
  const p = provider || {};
  const isMetaMask = !!p.isMetaMask;
  const isRabby = !!p.isRabby;
  const isTrust = !!p.isTrust || !!p.isTrustWallet;
  const isCoinbase = !!p.isCoinbaseWallet || !!p.isCoinbaseBrowser;
  const isOKX = !!p.isOkxWallet || !!p.isOKExWallet || !!p.isOKXWallet;
  const isBitget = !!p.isBitget || !!p.isBitgetWallet || !!p.isBitKeep;

  const detectedName =
    nameFromInfo ||
    (isMetaMask ? 'MetaMask' :
    isRabby ? 'Rabby' :
    isTrust ? 'Trust Wallet' :
    isCoinbase ? 'Coinbase Wallet' :
    isOKX ? 'OKX Wallet' :
    isBitget ? 'Bitget Wallet' :
    'Injected Wallet');

  const emojiIcon =
    (detectedName === 'MetaMask' && '🦊') ||
    (detectedName === 'Rabby' && '🐰') ||
    (detectedName === 'Trust Wallet' && '🔷') ||
    (detectedName === 'Coinbase Wallet' && '🟦') ||
    (detectedName === 'OKX Wallet' && '⚫') ||
    (detectedName === 'Bitget Wallet' && '🟢') ||
    '💼';

  return {
    id: uuid || detectedName,
    name: detectedName,
    // Prefer EIP-6963 icon if available, otherwise emoji fallback
    icon: icon || emojiIcon,
  };
};

export default function useInjectedProviders() {
  const [providers, setProviders] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    const addProvider = (provider, info) => {
      if (!provider) return;
      const meta = pickProviderMeta(provider, info);
      const key = meta.id || meta.name;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);
      setProviders((prev) => [...prev, { ...meta, provider }]);
    };

    // EIP-6963 discovery
    const onAnnounce = (event) => {
      try {
        const { info, provider } = event?.detail || {};
        addProvider(provider, info);
      } catch {}
    };
    try { window.addEventListener('eip6963:announceProvider', onAnnounce); } catch {}
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}

    // Legacy discovery (single or multiple providers)
    try {
      const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
      const potential = [];
      if (eth?.providers && Array.isArray(eth.providers)) {
        potential.push(...eth.providers);
      } else if (eth) {
        potential.push(eth);
      }
      potential.forEach((p) => addProvider(p));
    } catch {}

    return () => {
      try { window.removeEventListener('eip6963:announceProvider', onAnnounce); } catch {}
    };
  }, []);

  const uniqueProviders = useMemo(() => {
    // Keep stable order: EIP-6963 announcements then legacy
    const map = new Map();
    for (const p of providers) {
      if (!map.has(p.id)) map.set(p.id, p);
    }
    return Array.from(map.values());
  }, [providers]);

  return { providers: uniqueProviders };
}


