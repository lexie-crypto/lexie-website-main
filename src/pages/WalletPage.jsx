/**
 * Wallet Page Wrapper - decides mobile vs desktop before loading wallet logic
 */

import React, { useEffect, useState } from 'react';

const WalletPage = () => {
  const [isMobile, setIsMobile] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      setIsReady(true);
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)'); // Tailwind <sm
    const apply = () => { setIsMobile(mq.matches); setIsReady(true); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  if (!isReady) return null;

  if (isMobile) {
    const VaultMobileFallback = React.lazy(() => import('../components/vault/VaultMobileFallback.jsx'));
    return (
      <React.Suspense fallback={null}>
        <VaultMobileFallback />
      </React.Suspense>
    );
  }

  const VaultDesktop = React.lazy(() => import('../components/vault/VaultDesktop.jsx'));
  return (
    <React.Suspense fallback={null}>
      <VaultDesktop />
    </React.Suspense>
  );
};

export default WalletPage;


