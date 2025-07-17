/**
 * Wallet Page - Main wallet interface with privacy features
 * Integrates external wallet connection and Railgun privacy functionality
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { 
  WalletIcon, 
  ShieldCheckIcon, 
  EyeIcon, 
  EyeSlashIcon,
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import { hasWalletInStorage, loadWalletFromStorage } from '../utils/railgun/wallet';

const WalletPage = () => {
  const {
    // External wallet state
    isConnected,
    address,
    chainId,
    isConnecting,
    connectionError,
    
    // Railgun state
    isRailgunInitialized,
    isInitializingRailgun,
    railgunError,
    railgunWalletId,
    railgunAddress,
    isRailgunWalletLoaded,
    
    // Actions
    connectWallet,
    disconnectWallet,
    switchNetwork,
    setRailgunWallet,
    clearErrors,
    
    // Computed
    isReady,
    canUseRailgun,
    getCurrentNetwork,
    isNetworkSupported,
  } = useWallet();

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [currentView, setCurrentView] = useState('overview'); // overview, shield, transfer, unshield, settings
  
  // Check if privacy features are ready
  const isPrivacyReady = isRailgunInitialized && isRailgunWalletLoaded && isConnected && isNetworkSupported(chainId);
  
  // Check for existing Railgun wallet on mount
  useEffect(() => {
    if (canUseRailgun && !isRailgunWalletLoaded) {
      const savedWallet = loadWalletFromStorage();
      if (savedWallet) {
        setRailgunWallet(savedWallet.id, savedWallet.address);
        toast.success('Railgun wallet loaded from storage');
      }
    }
  }, [canUseRailgun, isRailgunWalletLoaded, setRailgunWallet]);

  // Handle wallet connection
  const handleConnectWallet = async (type = 'injected') => {
    try {
      await connectWallet(type);
      toast.success('Wallet connected successfully!');
    } catch (error) {
      toast.error(`Failed to connect wallet: ${error.message}`);
    }
  };

  // Handle network switch
  const handleSwitchNetwork = async (targetChainId) => {
    try {
      await switchNetwork(targetChainId);
      toast.success('Network switched successfully!');
    } catch (error) {
      toast.error(`Failed to switch network: ${error.message}`);
    }
  };

  // Clear all errors
  const handleClearErrors = () => {
    clearErrors();
    toast.success('Errors cleared');
  };

  // Render connection status
  const renderConnectionStatus = () => {
    if (isInitializingRailgun) {
      return (
        <div className="flex items-center space-x-2 text-yellow-400">
          <ClockIcon className="w-5 h-5 animate-spin" />
          <span>Loading Privacy Engine...</span>
        </div>
      );
    }

    if (railgunError) {
      return (
        <div className="flex items-center space-x-2 text-red-400">
          <ExclamationTriangleIcon className="w-5 h-5" />
          <span>Privacy engine error</span>
        </div>
      );
    }

    if (isRailgunInitialized && isRailgunWalletLoaded) {
      return (
        <div className="flex items-center space-x-2 text-green-400">
          <CheckCircleIcon className="w-5 h-5" />
          <span>Privacy engine ready</span>
        </div>
      );
    }

    if (isRailgunInitialized && !isRailgunWalletLoaded && isConnected) {
      return (
        <div className="flex items-center space-x-2 text-yellow-400">
          <ClockIcon className="w-5 h-5 animate-spin" />
          <span>Setting up privacy wallet...</span>
        </div>
      );
    }

    if (isRailgunInitialized) {
      return (
        <div className="flex items-center space-x-2 text-blue-400">
          <CheckCircleIcon className="w-5 h-5" />
          <span>Privacy engine ready</span>
        </div>
      );
    }

    return (
      <div className="flex items-center space-x-2 text-gray-400">
        <ClockIcon className="w-5 h-5" />
        <span>Initializing...</span>
      </div>
    );
  };

  // Render wallet connection section
  const renderWalletConnection = () => {
    if (!isConnected) {
      return (
        <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-xl p-8 border border-purple-500/30">
          <div className="text-center space-y-6">
            <div className="w-16 h-16 bg-purple-500/20 rounded-full flex items-center justify-center mx-auto">
              <WalletIcon className="w-8 h-8 text-purple-400" />
            </div>
            
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
              <p className="text-gray-300">
                Connect your Web3 wallet to start using Lexie's privacy features
              </p>
            </div>

            {connectionError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
                <div className="flex items-center space-x-2">
                  <ExclamationTriangleIcon className="w-5 h-5" />
                  <span>{connectionError}</span>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={() => handleConnectWallet('injected')}
                disabled={isConnecting}
                className="w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all duration-300 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
              </button>
              
              <button
                onClick={() => handleConnectWallet('walletconnect')}
                disabled={isConnecting}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-semibold rounded-lg hover:from-blue-700 hover:to-cyan-700 transition-all duration-300 disabled:opacity-50"
              >
                {isConnecting ? 'Connecting...' : 'Connect WalletConnect'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  // Render network info
  const renderNetworkInfo = () => {
    if (!isConnected) return null;

    const network = getCurrentNetwork();
    const isSupported = isNetworkSupported(chainId);

    return (
      <div className={`rounded-lg p-4 border ${isSupported ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${isSupported ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-white font-medium">
              {network?.name || `Chain ${chainId}`}
            </span>
          </div>
          
          {!isSupported && (
            <button
              onClick={() => handleSwitchNetwork(1)}
              className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
            >
              Switch to Ethereum
            </button>
          )}
        </div>
      </div>
    );
  };

  // Render main wallet interface
  const renderWalletInterface = () => {
    if (!isConnected || !canUseRailgun) return null;

    return (
      <div className="space-y-6">
        {/* Wallet Header */}
        <div className="bg-gradient-to-br from-gray-900/80 to-black/40 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                <WalletIcon className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Lexie Wallet</h2>
                <p className="text-gray-400 text-sm">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
              </div>
            </div>
            
            <button
              onClick={disconnectWallet}
              className="px-4 py-2 border border-gray-600 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
            >
              Disconnect
            </button>
          </div>

          {renderNetworkInfo()}
        </div>

        {/* Privacy Features */}
        <div className="bg-gradient-to-br from-gray-900/80 to-black/40 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <ShieldCheckIcon className="w-6 h-6 text-purple-400" />
              <h3 className="text-xl font-semibold text-white">Privacy Features</h3>
            </div>
            
            <button
              onClick={() => setShowPrivateMode(!showPrivateMode)}
              disabled={!isPrivacyReady}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-all duration-300 ${
                isPrivacyReady 
                  ? 'bg-purple-600 hover:bg-purple-700 text-white' 
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              {showPrivateMode ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              <span>{showPrivateMode ? 'Hide' : 'Show'} Private Mode</span>
            </button>
          </div>

          {/* Privacy Status */}
          <div className="mb-6 p-4 rounded-lg bg-black/30 border border-gray-600">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-white font-medium">Privacy Status</h4>
                <p className="text-gray-400 text-sm">
                  {isPrivacyReady 
                    ? 'Ready for private transactions' 
                    : isInitializingRailgun 
                      ? 'Loading privacy engine...' 
                      : !isRailgunInitialized 
                        ? 'Privacy engine starting...'
                        : !isRailgunWalletLoaded 
                          ? 'Setting up privacy wallet...'
                          : !isNetworkSupported(chainId)
                            ? 'Unsupported network'
                            : 'Not ready'
                  }
                </p>
              </div>
              <div className={`w-3 h-3 rounded-full ${
                isPrivacyReady ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'
              }`} />
            </div>

            {/* Railgun Wallet Info */}
            {isRailgunWalletLoaded && (
              <div className="mt-3 pt-3 border-t border-gray-600">
                <div className="text-xs text-gray-400">
                  <div>Privacy Address: {railgunAddress?.slice(0, 10)}...{railgunAddress?.slice(-8)}</div>
                  <div>Wallet ID: {railgunWalletId?.slice(0, 8)}...</div>
                </div>
              </div>
            )}
          </div>

          {/* Privacy Actions */}
          {showPrivateMode && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setCurrentView('shield')}
                  disabled={!isPrivacyReady}
                  className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                    isPrivacyReady 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Shield
                </button>
                <button
                  onClick={() => setCurrentView('transfer')}
                  disabled={!isPrivacyReady}
                  className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                    isPrivacyReady 
                      ? 'bg-purple-600 text-white hover:bg-purple-700' 
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Transfer
                </button>
                <button
                  onClick={() => setCurrentView('unshield')}
                  disabled={!isPrivacyReady}
                  className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${
                    isPrivacyReady 
                      ? 'bg-green-600 text-white hover:bg-green-700' 
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Unshield
                </button>
              </div>

              {/* Instructions when not ready */}
              {!isPrivacyReady && (
                <div className="text-center text-gray-400 text-sm py-4">
                  {!isRailgunInitialized && "Waiting for privacy engine to initialize..."}
                  {isRailgunInitialized && !isRailgunWalletLoaded && "Setting up your privacy wallet..."}
                  {isRailgunInitialized && isRailgunWalletLoaded && !isNetworkSupported(chainId) && "Please switch to a supported network"}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        {isConnected && !showPrivateMode && (
          <div className="bg-gradient-to-br from-gray-900/80 to-black/40 rounded-xl p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-4">
              <button className="p-4 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors text-left">
                <div className="text-white font-semibold">Send</div>
                <div className="text-gray-400 text-sm">Transfer tokens</div>
              </button>
              <button className="p-4 border border-gray-600 rounded-lg hover:bg-gray-700 transition-colors text-left">
                <div className="text-white font-semibold">Receive</div>
                <div className="text-gray-400 text-sm">Get your address</div>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Navigation */}
      <nav className="sticky top-0 z-40 w-full p-6 bg-black/80 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className="flex items-center space-x-2 text-gray-400 hover:text-white transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5" />
              <span>Back to Home</span>
            </Link>
          </div>
          
          <div className="text-2xl font-bold text-purple-300">
            LEXIE AI WALLET
          </div>
          
          <div className="flex items-center space-x-4">
            {renderConnectionStatus()}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Error Messages */}
        {(connectionError || railgunError) && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ExclamationTriangleIcon className="w-5 h-5 text-red-400" />
                <span className="text-red-400">
                  {connectionError || railgunError}
                </span>
              </div>
              <button
                onClick={handleClearErrors}
                className="text-red-400 hover:text-red-300 text-sm underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Wallet Connection */}
        {renderWalletConnection()}

        {/* Main Wallet Interface */}
        {renderWalletInterface()}

        {/* Development Info */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-8 bg-gray-900/50 rounded-lg p-4 border border-gray-700">
            <h4 className="text-sm font-semibold text-gray-400 mb-2">Development Info</h4>
            <div className="text-xs text-gray-500 space-y-1">
              <div>Connected: {isConnected ? 'Yes' : 'No'}</div>
              <div>Chain ID: {chainId || 'None'}</div>
              <div>Railgun Ready: {canUseRailgun ? 'Yes' : 'No'}</div>
              <div>Private Wallet: {isRailgunWalletLoaded ? 'Loaded' : 'Not loaded'}</div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default WalletPage; 