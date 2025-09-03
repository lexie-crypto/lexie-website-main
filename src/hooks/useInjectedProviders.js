/**
 * useInjectedProviders
 * Detects EIP-6963 announced providers and legacy injected providers.
 * Dedupes by brand (prefer EIP-6963), and normalizes names.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export default function useInjectedProviders() {
  const [providers6963, setProviders6963] = useState([]); // [{ info, provider }]
  const [legacyProviders, setLegacyProviders] = useState([]); // [{ info, provider }]

  useEffect(() => {
    const legacyList = [];

    // EIP-6963 discovery
    const onAnnounce = (event) => {
      try {
        const { info, provider } = event?.detail || {};
        if (!provider || !info) return;
        setProviders6963((prev) => {
          const next = [...prev, { info, provider }];
          const seen = new Set();
          return next.filter((d) => {
            const key = (d?.info?.rdns?.toLowerCase?.() || d?.info?.name?.toLowerCase?.() || '');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
      } catch {}
    };
    try { window.addEventListener('eip6963:announceProvider', onAnnounce); } catch {}
    try { window.dispatchEvent(new Event('eip6963:requestProvider')); } catch {}

    // Legacy discovery (single or multiple providers)
    try {
      const eth = typeof window !== 'undefined' ? window.ethereum : undefined;
      const potentials = [];
      if (eth?.providers && Array.isArray(eth.providers)) potentials.push(...eth.providers);
      else if (eth) potentials.push(eth);

      const toLegacyInfo = (p) => {
        const isMetaMask = !!p?.isMetaMask;
        const isRabby = !!p?.isRabby;
        const isTrust = !!p?.isTrust || !!p?.isTrustWallet;
        const isCoinbase = !!p?.isCoinbaseWallet || !!p?.isCoinbaseBrowser;
        const isOKX = !!p?.isOkxWallet || !!p?.isOKExWallet || !!p?.isOKXWallet;
        const isBitget = !!p?.isBitget || !!p?.isBitgetWallet || !!p?.isBitKeep;
        const isBrave = !!p?.isBraveWallet;

        // Map legacy flags to rdns for dedupe
        const rdns = (
          (isMetaMask && 'io.metamask') ||
          (isBrave && 'com.brave.wallet') ||
          (isRabby && 'io.rabby') ||
          (isOKX && 'com.okx.wallet') ||
          (isTrust && 'com.trustwallet.app') ||
          (isCoinbase && 'com.coinbase.wallet') ||
          (isBitget && 'com.bitget.wallet') ||
          ''
        );

        const name = (
          (isMetaMask && 'MetaMask') ||
          (isBrave && 'Brave Wallet') ||
          (isRabby && 'Rabby Wallet') ||
          (isOKX && 'OKX Wallet') ||
          (isTrust && 'Trust Wallet') ||
          (isCoinbase && 'Coinbase Wallet') ||
          (isBitget && 'Bitget Wallet') ||
          'Injected Wallet'
        );

        return { info: { uuid: undefined, rdns, name, icon: undefined }, provider: p };
      };

      potentials.forEach((p) => legacyList.push(toLegacyInfo(p)));
    } catch {}

    // Commit legacy once gathered
    setLegacyProviders(legacyList);

    return () => {
      try { window.removeEventListener('eip6963:announceProvider', onAnnounce); } catch {}
    };
  }, []);

  const providers = useMemo(() => {
    const BRAND_BY_RDNS = {
      'io.metamask': 'MetaMask',
      'com.brave.wallet': 'Brave Wallet',
      'io.rabby': 'Rabby Wallet',
      'com.okx.wallet': 'OKX Wallet',
      'com.trustwallet.app': 'Trust Wallet',
      'com.coinbase.wallet': 'Coinbase Wallet',
      'com.bitget.wallet': 'Bitget Wallet',
    };

    const canonicalKey = (d) => {
      const rdns = d?.info?.rdns?.toLowerCase();
      const name = d?.info?.name?.toLowerCase();
      return rdns || name || '';
    };
    const normalizeName = (d) => {
      const rdns = d?.info?.rdns?.toLowerCase() || '';
      return BRAND_BY_RDNS[rdns] || d?.info?.name || 'Injected Wallet';
    };

    // 1) Prefer 6963
    const seen = new Set();
    const prefer = [];
    for (const d of providers6963) {
      const key = canonicalKey(d);
      if (!seen.has(key)) { seen.add(key); prefer.push(d); }
    }

    // 2) Add legacy only if not already seen
    const merged = [...prefer];
    for (const d of legacyProviders) {
      const key = canonicalKey(d);
      if (!seen.has(key)) { seen.add(key); merged.push(d); }
    }

    // 3) Normalize display name and flatten to minimal shape for UI
    const ORDER = ['Brave Wallet','Rabby Wallet','MetaMask','Coinbase Wallet','Trust Wallet','OKX Wallet','Bitget Wallet'];
    const finalProviders = merged.map((d) => ({
      info: {
        uuid: d?.info?.uuid,
        rdns: d?.info?.rdns,
        name: normalizeName(d),
        icon: d?.info?.icon,
      },
      provider: d.provider,
    }));

    finalProviders.sort((a, b) => {
      const an = a.info.name;
      const bn = b.info.name;
      const ai = ORDER.indexOf(an);
      const bi = ORDER.indexOf(bn);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    return finalProviders;
  }, [providers6963, legacyProviders]);

  return { providers };
}


