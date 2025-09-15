import { useEffect, useRef, useState } from 'react';

export function useGlobalTreeStatus(walletId, chainId) {
  const [status, setStatus] = useState(null);
  const sseRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!walletId || !chainId) return;

    let cancelled = false;

    const init = async () => {
      try {
        const ts = Date.now().toString();
        // Assume window.__LEXIE_HMAC_SIGN is available to sign requests; otherwise server should proxy SSE
        const path = `/api/vault/init`;
        const method = 'POST';
        const signature = window.__LEXIE_HMAC_SIGN ? window.__LEXIE_HMAC_SIGN(method, path, ts) : undefined;
        await fetch(path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(signature ? { 'X-Lexie-Timestamp': ts, 'X-Lexie-Signature': signature } : {}),
          },
          body: JSON.stringify({ walletId, chainId })
        });
      } catch (_) {}

      // Open SSE
      try {
        const qs = `walletId=${encodeURIComponent(walletId)}&chainId=${encodeURIComponent(String(chainId))}`;
        const url = `/api/vault/stream?${qs}`;
        const es = new EventSource(url, { withCredentials: true });
        sseRef.current = es;
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            const next = data?.status || data;
            if (!cancelled && next) setStatus(next);
          } catch {}
        };
        es.onerror = () => {
          try { es.close(); } catch {}
          sseRef.current = null;
          // Fallback to polling
          startPolling();
        };
      } catch (_) {
        startPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const ts = Date.now().toString();
          const path = `/api/vault/status?walletId=${encodeURIComponent(walletId)}&chainId=${encodeURIComponent(String(chainId))}`;
          const method = 'GET';
          const signature = window.__LEXIE_HMAC_SIGN ? window.__LEXIE_HMAC_SIGN(method, path, ts) : undefined;
          const res = await fetch(path, {
            headers: {
              ...(signature ? { 'X-Lexie-Timestamp': ts, 'X-Lexie-Signature': signature } : {}),
            }
          });
          if (!res.ok) return;
          const json = await res.json();
          if (!cancelled && json) setStatus(json);
        } catch {}
      }, 1500);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    init();
    return () => {
      cancelled = true;
      stopPolling();
      try { sseRef.current?.close(); } catch {}
      sseRef.current = null;
    };
  }, [walletId, chainId]);

  const isComplete = !!(status && status.treeLength > 0 && typeof status.mostRecentValidCommitmentBlock === 'number');

  return { status, isComplete };
}


