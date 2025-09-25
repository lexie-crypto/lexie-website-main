import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Analytics } from "@vercel/analytics/react";

import { WalletProvider } from './contexts/WalletContext';
import LandingPage from './pages/LandingPage';
import WalletPage from './pages/WalletPage';
import AdminHistoryPage from './pages/AdminHistoryPage';

// PaymentPage moved to subdomain - redirect component
const PaymentRedirect = () => {
  React.useEffect(() => {
    // Get current URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const subdomainUrl = `https://staging.pay.lexiecrypto.com/pay?${urlParams.toString()}`;

    // Redirect to subdomain
    window.location.href = subdomainUrl;
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center">
        <div className="text-green-300 text-lg mb-2">Redirecting to payment page...</div>
        <div className="text-green-400/70 text-sm">Payment processing has moved to a dedicated subdomain</div>
      </div>
    </div>
  );
};

function App() {
  const [showMobileDebug, setShowMobileDebug] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile and initialize Eruda
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
    };

    checkMobile();
  }, []);

  const toggleMobileDebug = async () => {
    if (!isMobile) return;
    
    try {
      const eruda = await import('eruda');
      if (showMobileDebug) {
        eruda.default.destroy();
        setShowMobileDebug(false);
      } else {
        eruda.default.init();
        setShowMobileDebug(true);
      }
    } catch (error) {
      console.error('Failed to toggle Eruda:', error);
    }
  };

  return (
    <WalletProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/LexieVault" element={<WalletPage />} />
            <Route path="/pay" element={<PaymentRedirect />} />
            <Route path="/admin-history" element={<AdminHistoryPage />} />
          </Routes>
          
          {/* Mobile Debug Gear Icon */}
          {isMobile && (
            <button
              onClick={toggleMobileDebug}
              className="fixed top-4 right-4 z-50 w-10 h-10 bg-gray-800/90 hover:bg-gray-700/90 text-white rounded-full flex items-center justify-center border border-gray-600/50 backdrop-blur-sm"
              title="Toggle Debug Console"
            >
              ⚙️
            </button>
          )}
          
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