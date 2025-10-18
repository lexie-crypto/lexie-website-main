/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';

const WalletPage = () => {
  // VaultDesktop now handles mobile/desktop rendering internally
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hiddenscrollbar-terminal">

      {/* Logo in top left - redirects to main site - only on desktop */}
      {!isMobile && (
        <div className="absolute md:top-6 md:left-5 -top-2 left-1 z-50 md:pl-6">
          <a
            href="https://www.lexiecrypto.com"
            className="hover:opacity-80 transition-opacity"
          >
            <span className="text-4xl font-bold text-purple-300">LEXIEAI</span>
          </a>
        </div>
      )}

      <AccessCodeGate>
        <VaultDesktop />
      </AccessCodeGate>
    </div>
  );
};

export default WalletPage;


