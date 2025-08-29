import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Analytics } from "@vercel/analytics/react";

import { WalletProvider } from './contexts/WalletContext';
import LandingPage from './pages/LandingPage';
import WalletPage from './pages/WalletPage';
import PaymentPage from './pages/PaymentPage';

function App() {
  return (
    <WalletProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/vault" element={<WalletPage />} />
            <Route path="/pay" element={<PaymentPage />} />
          </Routes>
          
          {/* Toast notifications */}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1f2937',
                color: '#f3f4f6',
                border: '1px solid #6366f1',
              },
              success: {
                iconTheme: {
                  primary: '#10b981',
                  secondary: '#f3f4f6',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#f3f4f6',
                },
              },
            }}
          />
          
          <Analytics />
        </div>
      </Router>
    </WalletProvider>
  );
}

export default App; 