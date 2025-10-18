/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';

const WalletPage = () => {
  // VaultDesktop now handles mobile/desktop rendering internally
  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hiddenscrollbar-terminal">
      {/* Logo in top left - redirects to main site */}
      <div className="absolute top-6 left-5 z-50 pl-6">
        <a
          href="https://www.lexiecrypto.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80 transition-opacity"
        >
          <span className="text-3xl font-bold text-purple-300">LEXIEAI</span>
        </a>
      </div>

      <AccessCodeGate>
        <VaultDesktop />
      </AccessCodeGate>
    </div>
  );
};

export default WalletPage;


