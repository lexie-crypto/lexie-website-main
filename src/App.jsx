import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Analytics } from "@vercel/analytics/react";

import { WalletProvider } from './contexts/WalletContext';
import LandingPage from './pages/LandingPage';
import WalletPage from './pages/WalletPage';
import PaymentPage from './pages/PaymentPage';
import AdminHistoryPage from './pages/AdminHistoryPage';
import ChatPage from './pages/ChatPage';
import TermsAndConditions from './pages/TermsAndConditions';
import PrivacyPolicy from './pages/PrivacyPolicy';

// PaymentPage moved to subdomain - redirect component
const PaymentRedirect = () => {
  const [redirectAttempted, setRedirectAttempted] = React.useState(false);
  const [manualRedirect, setManualRedirect] = React.useState(false);

  React.useEffect(() => {
    // Get current URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const subdomainUrl = `https://pay.lexiecrypto.com/pay?${urlParams.toString()}`;

    console.log('[PaymentRedirect] Attempting redirect to:', subdomainUrl);

    // If we've already tried redirecting, show manual option
    if (redirectAttempted) {
      setManualRedirect(true);
      return;
    }

    // Mark that we're attempting redirect
    setRedirectAttempted(true);

    // Small delay to ensure component renders, then redirect
    const redirectTimer = setTimeout(() => {
      try {
        console.log('[PaymentRedirect] Executing redirect...');
        window.location.replace(subdomainUrl);
      } catch (error) {
        console.error('[PaymentRedirect] Redirect failed:', error);
        // Fallback: try href instead of replace
        try {
          window.location.href = subdomainUrl;
        } catch (fallbackError) {
          console.error('[PaymentRedirect] Fallback redirect also failed:', fallbackError);
          setManualRedirect(true);
        }
      }
    }, 1000); // Increased delay to 1 second

    // If redirect doesn't happen within 5 seconds, show manual option
    const manualTimer = setTimeout(() => {
      console.log('[PaymentRedirect] Redirect may have failed, showing manual option');
      setManualRedirect(true);
    }, 5000);

    return () => {
      clearTimeout(redirectTimer);
      clearTimeout(manualTimer);
    };
  }, [redirectAttempted]);

  const urlParams = new URLSearchParams(window.location.search);
  const subdomainUrl = `https://pay.lexiecrypto.com/pay?${urlParams.toString()}`;

  return (
    <div className="h-screen bg-black text-white flex items-center justify-center">
      <div className="text-center max-w-md mx-auto px-4">
        <div className="text-green-300 text-lg mb-4">Redirecting to payment page...</div>
        <div className="text-green-400/70 text-sm mb-6">
          Payment processing has moved to a dedicated subdomain
        </div>

        {manualRedirect && (
          <div className="bg-red-900/20 border border-red-500/40 rounded p-4 mb-4">
            <div className="text-red-300 text-sm mb-3">
              ⚠️ Automatic redirect failed. Please click below to continue:
            </div>
            <a
              href={subdomainUrl}
              className="inline-block bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 px-4 py-2 rounded border border-blue-400/40 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Payment Page
            </a>
          </div>
        )}

        <div className="text-green-400/50 text-xs">
          URL: {subdomainUrl}
        </div>
      </div>
    </div>
  );
};

function App() {
  const [showMobileDebug, setShowMobileDebug] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Check if we're on the payment subdomain
  const isPaymentSubdomain = typeof window !== 'undefined' &&
    window.location.hostname === 'pay.lexiecrypto.com';

  // Detect mobile and initialize Eruda
  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);

      // Auto-initialize Eruda on mobile devices
      if (mobile && typeof window !== 'undefined') {
        // Small delay to ensure DOM is ready
        setTimeout(async () => {
          try {
            const eruda = await import('eruda');
            eruda.default.init({
              defaults: {
                displaySize: 50,
                transparency: 0.9,
                theme: 'Monokai Pro'
              }
            });
            setShowMobileDebug(true);
            console.log('🛠️ Eruda mobile debugging initialized');
          } catch (error) {
            console.error('Failed to initialize Eruda:', error);
          }
        }, 1000);
      }
    };

    checkMobile();
  }, []);

  // If on payment subdomain, serve PaymentPage directly
  if (isPaymentSubdomain) {
    return (
      <WalletProvider>
        <PaymentPage />
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
      </WalletProvider>
    );
  }

  return (
    <WalletProvider>
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/LexieVault" element={<WalletPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/pay" element={<PaymentRedirect />} />
            <Route path="/admin-history" element={<AdminHistoryPage />} />
            <Route path="/t&cs" element={<TermsAndConditions />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
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