import React, { useState, useEffect } from 'react';
import { VaultDesktopInner } from './VaultDesktop.jsx';
import { WindowProvider } from '../../contexts/windowStore.jsx';

// Load Eruda for mobile debugging
const loadEruda = async () => {
  if (typeof window !== 'undefined' && !window.eruda) {
    try {
      // Load Eruda script
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/eruda';
      script.onload = () => {
        if (window.eruda) {
          window.eruda.init();
          window.eruda.hide();
        }
      };
      document.head.appendChild(script);
    } catch (error) {
      console.warn('Failed to load Eruda:', error);
    }
  }
};

const toggleEruda = () => {
  if (window.eruda) {
    if (window.eruda._isShow) {
      window.eruda.hide();
    } else {
      window.eruda.show();
    }
  } else {
    loadEruda().then(() => {
      if (window.eruda) {
        window.eruda.show();
      }
    });
  }
};

const LexieMobileShell = () => {
  const [activeModule, setActiveModule] = useState('vault');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Load Eruda on component mount (only in development/staging)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' ||
        window.location.hostname.includes('staging') ||
        window.location.hostname.includes('localhost')) {
      loadEruda();
    }
  }, []);

  // Global error handler for React errors
  useEffect(() => {
    const handleError = (event) => {
      console.error('React Error Boundary caught:', event.error);
      setHasError(true);
      setErrorMessage(event.error.message || 'Unknown error');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled Promise Rejection:', event.reason);
      setHasError(true);
      setErrorMessage(event.reason?.message || 'Unhandled promise rejection');
    });

    return () => {
      window.removeEventListener('error', handleError);
    };
  }, []);

  const modules = [
    { id: 'home', name: 'Home', color: 'text-green-300' },
    { id: 'vault', name: 'LexieVault', color: 'text-purple-300' },
    { id: 'chat', name: 'LexieChat', color: 'text-blue-300' },
    { id: 'titans', name: 'LexieTitans', color: 'text-orange-300' }
  ];

  const handleModuleSwitch = (moduleId) => {
    if (moduleId === activeModule) return;

    setIsTransitioning(true);
    setMenuOpen(false);

    setTimeout(() => {
      setActiveModule(moduleId);
      setIsTransitioning(false);
    }, 200);
  };

  const renderModuleContent = () => {
    switch (activeModule) {
      case 'home':
        return (
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
            <div className="text-center space-y-8">
              <div className="space-y-4">
                <div className="text-4xl font-bold text-purple-300">LEXIEAI</div>
                <div className="text-lg text-green-300/80">Mobile Terminal</div>
              </div>

              <div className="bg-black/40 border border-green-500/30 rounded-lg p-6 max-w-sm">
                <div className="space-y-4">
                  <div className="text-sm text-green-300/70">
                    Welcome to LexieOS Mobile
                  </div>
                  <div className="text-xs text-green-400/60 space-y-2">
                    <div>• Access your vault securely</div>
                    <div>• Chat with LexieAI</div>
                    <div>• Play LexieTitans</div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-green-500/50">
                Tap the menu (☰) to navigate
              </div>
            </div>
          </div>
        );

      case 'vault':
        try {
          return (
            <WindowProvider>
              <VaultDesktopInner />
            </WindowProvider>
          );
        } catch (error) {
          console.error('Error rendering VaultDesktopInner:', error);
          return (
            <div className="flex flex-col items-center justify-center min-h-[calc(100vh-80px)] px-6">
              <div className="text-center space-y-4">
                <div className="text-2xl font-bold text-red-300">Error Loading Vault</div>
                <div className="text-sm text-red-300/70">There was an error loading the vault interface</div>
                <div className="text-xs text-red-400/60">Check console for details</div>
              </div>
            </div>
          );
        }

      case 'chat':
        return (
          <div className="flex flex-col min-h-[calc(100vh-80px)]">
            <div className="flex-1 p-4 space-y-4">
              <div className="text-center py-8">
                <div className="text-2xl font-bold text-blue-300">LexieChat</div>
                <div className="text-sm text-blue-300/70 mt-2">AI Assistant Terminal</div>
              </div>

              <div className="bg-black/40 border border-blue-500/30 rounded-lg p-4">
                <div className="text-sm text-blue-300/80">
                  Chat interface would load here...
                </div>
              </div>
            </div>
          </div>
        );

      case 'titans':
        return (
          <div className="flex flex-col min-h-[calc(100vh-80px)]">
            <div className="flex-1 p-4 space-y-4">
              <div className="text-center py-8">
                <div className="text-2xl font-bold text-orange-300">LexieTitans</div>
                <div className="text-sm text-orange-300/70 mt-2">Blockchain Gaming</div>
              </div>

              <div className="bg-black/40 border border-orange-500/30 rounded-lg p-4">
                <div className="text-sm text-orange-300/80">
                  Game interface would load here...
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const currentModule = modules.find(m => m.id === activeModule);

  // Show error screen if there's a React error
  if (hasError) {
    return (
      <div className="relative min-h-screen w-full bg-black text-white overflow-hidden flex items-center justify-center">
        <div className="text-center space-y-4 px-6">
          <div className="text-3xl font-bold text-red-300">System Error</div>
          <div className="text-sm text-red-300/70">Something went wrong with the mobile interface</div>
          <div className="text-xs text-red-400/60 bg-black/40 p-3 rounded border border-red-500/30 max-w-sm">
            {errorMessage}
          </div>
          <button
            onClick={() => {
              setHasError(false);
              setErrorMessage('');
              window.location.reload();
            }}
            className="bg-red-600/30 hover:bg-red-600/50 text-red-200 py-2 px-4 rounded border border-red-400/40 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-hidden">
      {/* Background Effects */}
      <div className="fixed inset-0 opacity-20">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.1)_1px,transparent_1px)] bg-[size:20px_20px]"></div>
      </div>

      {/* Header Bar */}
      <div className="relative z-20 flex items-center justify-between px-4 py-3 bg-black/80 border-b border-green-500/20">
        <div className="text-green-400 text-xl font-mono">&gt;</div>

        <div className={`text-lg font-bold transition-colors duration-300 ${currentModule?.color || 'text-green-300'}`}>
          {currentModule?.name || 'Home'}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={toggleEruda}
            className="text-green-400 hover:text-green-300 transition-colors text-lg p-1"
            aria-label="Debug Tools"
            title="Open Eruda Debug Tools"
          >
            ⚙️
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-green-400 hover:text-green-300 transition-colors text-xl p-1"
            aria-label="Menu"
          >
            ☰
          </button>
        </div>
      </div>

      {/* Slide-out Menu */}
      <div className={`fixed top-0 right-0 h-full w-64 bg-black/95 border-l border-green-500/20 z-30 transform transition-transform duration-300 ease-in-out ${
        menuOpen ? 'translate-x-0' : 'translate-x-full'
      }`}>
        <div className="pt-16 px-6">
          <div className="space-y-2">
            {modules.map((module) => (
              <button
                key={module.id}
                onClick={() => handleModuleSwitch(module.id)}
                className={`w-full text-left py-3 px-4 rounded border transition-all duration-200 font-mono ${
                  activeModule === module.id
                    ? 'bg-green-900/30 border-green-400/50 text-green-300'
                    : 'border-transparent hover:border-green-500/30 text-green-400/70 hover:text-green-300'
                }`}
              >
                {module.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu Overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className={`relative z-10 transition-opacity duration-200 ${
        isTransitioning ? 'opacity-0' : 'opacity-100'
      }`}>
        {renderModuleContent()}
      </div>

      {/* Terminal Flicker Effect */}
      <div className="fixed inset-0 pointer-events-none z-40">
        <div className="absolute inset-0 bg-green-400/5 animate-pulse opacity-0"></div>
      </div>
    </div>
  );
};

const VaultMobileFallback = () => {
  return <LexieMobileShell />;
};

export default VaultMobileFallback;


