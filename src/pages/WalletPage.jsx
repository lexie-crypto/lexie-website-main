/**
 * Wallet Page Wrapper - gates access with access codes before loading wallet logic
 */

import React, { useState } from 'react';
import AccessCodeGate from '../components/AccessCodeGate.jsx';
import VaultDesktop from '../components/vault/VaultDesktop.jsx';
import WindowShell from '../components/window/WindowShell.jsx';
import { WindowProvider, useWindowStore } from '../contexts/windowStore.jsx';
import Taskbar from '../components/window/Taskbar.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { WalletIcon } from '@heroicons/react/24/outline';
import InjectedProviderButtons from '../components/InjectedProviderButtons.jsx';
import { useWallet } from '../contexts/WalletContext';
import ChatPage from './ChatPage.tsx';

const WalletConnectWindow = ({ isMobile, onWalletConnected }) => {
  const { isConnected, isConnecting, wasDisconnectedForUnsupportedNetwork, walletConnectValidating } = useWallet();

  // If wallet is already connected, don't show this window
  if (isConnected) {
    return null;
  }

  // If we're in the VaultDesktop component, let it handle the connection UI
  if (onWalletConnected) {
    return null;
  }

  // Mobile version - Navbar + WindowShell with terminal theme but no traffic lights
  if (isMobile) {
    return (
      <div className="min-h-screen bg-black">
        <Navbar />
        <div className="relative bg-black text-white overflow-x-hidden scrollbar-terminal">
          {/* Background overlays */}
          <div className="fixed inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
            <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
            <div className="absolute inset-0 opacity-30">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
              <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
            </div>
            <div className="absolute inset-0 overflow-hidden scrollbar-terminal">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full animate-pulse"
                  style={{
                    left: `${20 + i * 30}%`,
                    top: `${20 + i * 20}%`,
                    width: `${200 + i * 100}px`,
                    height: `${200 + i * 100}px`,
                    background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                    animationDelay: `${i * 2}s`,
                    animationDuration: `${6 + i * 2}s`,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
            <WindowShell
              id="lexie-vault-connect"
              title="lexie-vault-connect"
              statusLabel={wasDisconnectedForUnsupportedNetwork ? 'NETWORK ERROR' : (isConnecting ? 'WAITING' : 'READY')}
              statusTone={wasDisconnectedForUnsupportedNetwork ? 'error' : (isConnecting ? 'waiting' : 'online')}
              footerLeft={<span>Process: wallet-connect</span>}
              variant="connect"
              className="overflow-hidden"
              appType="connect"
            >
              <div className="font-mono text-green-300 text-center">
                <WalletIcon className="h-16 w-16 text-emerald-300 mx-auto mb-6" />
                <h2 className="text-2xl font-semibold text-emerald-300 tracking-tight">Connect Wallet</h2>
                <p className="mt-2 text-emerald-300/80 text-center text-sm leading-6">
                  {wasDisconnectedForUnsupportedNetwork
                    ? "Your wallet was disconnected because it's connected to an unsupported network. Please switch to Ethereum, Arbitrum, Polygon, or BNB Chain and try again."
                    : "Connect your wallet to gain access to the LexieVault features."
                  }
                </p>

                <div className="space-y-4">
                  <InjectedProviderButtons disabled={isConnecting} />
                </div>

                <div className="mt-6 text-sm text-green-400/70 text-center">
                  <p>Choose your preferred wallet to connect</p>
                  <p className="mt-1 pb-3 text-xs">Connection is zk-secured and encrypted</p>
                </div>
              </div>
            </WindowShell>
          </div>
        </div>
      </div>
    );
  }

  // Desktop version - WindowShell with content
  return (
    <div className="relative h-screen w-full bg-black text-white overflow-x-hidden scrollbar-terminal">
      {/* Background overlays */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>
        <div className="absolute inset-0 overflow-hidden scrollbar-terminal">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full animate-pulse"
              style={{
                left: `${20 + i * 30}%`,
                top: `${20 + i * 20}%`,
                width: `${200 + i * 100}px`,
                height: `${200 + i * 100}px`,
                background: `radial-gradient(circle, rgba(147, 51, 234, 0.1) 0%, rgba(147, 51, 234, 0.05) 50%, transparent 100%)`,
                animationDelay: `${i * 2}s`,
                animationDuration: `${6 + i * 2}s`,
              }}
            />
          ))}
        </div>
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
        <WindowShell
          id="lexie-vault-connect"
          title="lexie-vault-connect"
          statusLabel={wasDisconnectedForUnsupportedNetwork ? 'NETWORK ERROR' : (isConnecting ? 'WAITING' : 'READY')}
          statusTone={wasDisconnectedForUnsupportedNetwork ? 'error' : (isConnecting ? 'waiting' : 'online')}
          footerLeft={<span>Process: wallet-connect</span>}
          variant="connect"
          className="overflow-hidden"
          appType="connect"
        >
          <div className="font-mono text-green-300 text-center">
            <WalletIcon className="h-16 w-16 text-emerald-300 mx-auto mb-6" />
            <h2 className="text-2xl font-semibold text-emerald-300 tracking-tight">Connect Wallet</h2>
            <p className="mt-2 text-emerald-300/80 text-center text-sm leading-6">
              {wasDisconnectedForUnsupportedNetwork
                ? "Your wallet was disconnected because it's connected to an unsupported network. Please switch to Ethereum, Arbitrum, Polygon, or BNB Chain and try again."
                : "Connect your wallet to gain access to the LexieVault features."
              }
            </p>

            <div className="space-y-4">
              <InjectedProviderButtons disabled={isConnecting} />
            </div>

            <div className="mt-6 text-sm text-green-400/70 text-center">
              <p>Choose your preferred wallet to connect</p>
              <p className="mt-1 pb-3 text-xs">Connection is zk-secured and encrypted</p>
            </div>
          </div>
        </WindowShell>
      </div>
    </div>
  );
};

// Inner component that uses window store hooks
const WalletPageInner = () => {
  const { isConnected, isConnecting, wasDisconnectedForUnsupportedNetwork, walletConnectValidating } = useWallet();
  const [isMobile, setIsMobile] = React.useState(false);
  const [showLexieChat, setShowLexieChat] = useState(false);
  const { getWindowState, reopenWindow } = useWindowStore();

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return;
    }
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => { setIsMobile(mq.matches); };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', apply);
      else if (mq.removeListener) mq.removeListener(apply);
    };
  }, []);

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden scrollbar-terminal">
      {/* Logo in top left - redirects to main site - only on desktop */}
      {!isMobile && (
        <div className="absolute md:top-6 md:left-5 -top-2 left-1 z-50 md:pl-6">
          <a
            href="https://www.lexiecrypto.com"
            className="hover:opacity-80 transition-opacity"
          >
            <span className="text-4xl font-bold text-purple-300">LEXIEAI</span>
          </a>
        </div>
      )}

      <AccessCodeGate>
        {isConnected ? (
          <VaultDesktop externalWindowProvider={true} />
        ) : (
          <WalletConnectWindow isMobile={isMobile} />
        )}
      </AccessCodeGate>

      {/* Lexie Logo - Only show on desktop */}
      {!isMobile && (
        <div className="fixed bottom-2 right-1 z-10">
          <img
            src="/lexie.png"
            alt="Lexie"
            className="w-[320px] h-[320px] opacity-80 hover:opacity-80 transition-opacity cursor-pointer"
            title="Click here to open up LexieChat"
            onClick={() => {
              const windowState = getWindowState('lexie-chat-terminal');
              // If window exists and is closed, reopen it first
              if (windowState && windowState.isClosed) {
                reopenWindow('lexie-chat-terminal');
              }
              setShowLexieChat(true);
            }}
          />
        </div>
      )}

      {/* LexieAI Chat Window - Desktop */}
      {showLexieChat && !isMobile && (
        <WindowShell
          id="lexie-chat-terminal"
          title="LexieAI-chat"
          appType="chat"
          statusLabel="Enable Degen Mode"
          statusTone="online"
          footerLeft="LexieAI Chat Terminal"
          footerRight="Secure LexieAI Communication Channel"
          variant="vault"
          fullscreen={false}
          onClose={() => setShowLexieChat(false)}
          initialSize={{ width: 1000, height: 700 }}
          initialPosition={{ x: 200, y: 100 }}
          minSize={{ width: 800, height: 600 }}
          className="z-[98]"
        >
          <ChatPage />
        </WindowShell>
      )}

      {/* Taskbar for minimized windows - Desktop only */}
      {!isMobile && <Taskbar />}
    </div>
  );
};

const WalletPage = () => {
  return (
    <WindowProvider>
      <WalletPageInner />
    </WindowProvider>
  );
};

export default WalletPage;


