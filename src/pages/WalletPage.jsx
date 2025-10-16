/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';

const WalletPage = () => {
  // VaultDesktop now handles mobile/desktop rendering internally
  return (
    <AccessCodeGate>
      <VaultDesktop />
    </AccessCodeGate>
  );
};

export default WalletPage;


