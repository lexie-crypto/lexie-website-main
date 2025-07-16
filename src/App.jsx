import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import WalletPage from './pages/WalletPage';
import { Analytics } from "@vercel/analytics/react";
import WalletProvider from './contexts/WalletContext';

function App() {
  return (
    <WalletProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/wallet" element={<WalletPage />} />
          </Routes>
          <Analytics />
        </div>
      </Router>
    </WalletProvider>
  );
}

export default App; 