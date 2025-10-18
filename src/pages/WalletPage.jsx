/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';

const WalletPage = () => {
  // VaultDesktop now handles mobile/desktop rendering internally
  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hiddenscrollbar-terminal md:pt-0 pt-16">
      {/* Logo in top left - redirects to main site */}
      <div className="absolute md:top-6 md:left-5 top-2 left-2 z-50 md:pl-6 pl-2">
        <a
          href="https://www.lexiecrypto.com"
          className="hover:opacity-80 transition-opacity"
        >
          <span className="text-4xl font-bold text-purple-300">LEXIEAI</span>
        </a>
      </div>

      <AccessCodeGate>
        <VaultDesktop />
      </AccessCodeGate>
    </div>
  );
};

export default WalletPage;


