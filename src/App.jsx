import React from 'react';
import LandingPage from './pages/LandingPage';
import { Analytics } from "@vercel/analytics/react";
import WalletProvider from './contexts/WalletContext';

function App() {
  return (
    <WalletProvider>
      <div className="App">
        <LandingPage />
        <Analytics />
      </div>
    </WalletProvider>
  );
}

export default App; 