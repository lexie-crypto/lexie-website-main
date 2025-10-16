/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React, { useState } from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';
import ChainSelector from '../components/ChainSelector.jsx';

const WalletPage = () => {
  // Selected chain state - defaults to Ethereum (chain ID 1)
  const [selectedChainId, setSelectedChainId] = useState(1);

  // VaultDesktop now handles mobile/desktop rendering internally
  return (
    <>
      {/* Chain selection happens before access code gate */}
      <div className="relative z-10 max-w-md mx-auto px-6 sm:px-8 lg:px-12 py-8">
        <ChainSelector
          selectedChainId={selectedChainId}
          onChainSelect={setSelectedChainId}
        />
      </div>

      <AccessCodeGate>
        <VaultDesktop selectedChainId={selectedChainId} />
      </AccessCodeGate>
    </>
  );
};

export default WalletPage;


