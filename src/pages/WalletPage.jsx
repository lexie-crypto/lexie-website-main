/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';

const WalletPage = () => {
  // VaultDesktop now handles mobile/desktop rendering internally
  return (
    <div className="relative min-h-screen bg-black">
      {/* LEXIEAI Header */}
      <div className="absolute top-0 left-0 z-50 p-4">
        <a
          href="https://www.lexiecrypto.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-green-300 font-mono text-lg font-bold hover:text-emerald-400 transition-colors"
        >
          LEXIEAI
        </a>
      </div>

      <AccessCodeGate>
        <VaultDesktop />
      </AccessCodeGate>
    </div>
  );
};

export default WalletPage;


