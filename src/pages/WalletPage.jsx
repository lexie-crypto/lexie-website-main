/**
 * Wallet Page - Main wallet interface with privacy features
 * Integrates external wallet connection and Railgun privacy functionality
 */

import React, { useState, useEffect } from 'react';
import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import PrivacyActions from '../components/PrivacyActions';
import TransactionHistory from '../components/TransactionHistory';

const WalletPage = () => {
  const [activeTab, setActiveTab] = useState('overview');

  const {
    isConnected,
    isConnecting,
    address,
    chainId,
    railgunWalletId,
    railgunAddress,
    isRailgunInitialized,
    isInitializingRailgun,
    canUseRailgun,
    railgunError,
    connectWallet, // Use the simplified connectWallet function
    disconnectWallet,
    switchNetwork,
    getCurrentNetwork,
    isWalletAvailable,
    getConnectionDebugInfo,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    isLoading: isLoadingBalances,
    refreshAllBalances,
    formatBalance,
  } = useBalances();

  const [showDebugInfo, setShowDebugInfo] = useState(false);

  // Show wallet connection UI if not connected
  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-800 flex items-center justify-center p-4">
        <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl p-8 max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Connect Wallet</h1>
            <p className="text-gray-300">Choose your preferred wallet to get started</p>
          </div>
          
          <div className="space-y-4">
            {/* MetaMask */}
            <button
              onClick={() => connectWallet('metamask')}
              disabled={isConnecting || !isWalletAvailable('metamask')}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🦊</span>
              <span>
                {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
              </span>
            </button>
            
            {/* WalletConnect */}
            <button
              onClick={() => connectWallet('walletconnect')}
              disabled={isConnecting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 px-6 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🌐</span>
              <span>
                {isConnecting ? 'Connecting...' : 'Connect with WalletConnect'}
              </span>
            </button>
          </div>
          
          {!isWalletAvailable('metamask') && (
            <p className="text-amber-400 text-sm mt-4 text-center">
              MetaMask not detected. Please install MetaMask or use WalletConnect.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-violet-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl p-6 mb-8">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Privacy Wallet</h1>
              <p className="text-gray-300">
                Secure, private transactions on Ethereum and Layer 2 networks
              </p>
            </div>
            <button
              onClick={disconnectWallet}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Wallet Status */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Wallet Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-300">Connected:</span>
                <span className="text-green-400">✓ Yes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Network:</span>
                <span className="text-blue-400">{getCurrentNetwork()?.name || 'Unknown'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-300">Address:</span>
                <span className="text-white font-mono text-xs">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </span>
              </div>
            </div>
          </div>

          {/* RAILGUN Status */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">RAILGUN Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-300">Initialized:</span>
                <span className={isRailgunInitialized ? "text-green-400" : "text-yellow-400"}>
                  {isInitializingRailgun ? "🔄 Loading..." : isRailgunInitialized ? "✓ Ready" : "✗ Not Ready"}
                </span>
              </div>
              {railgunAddress && (
                <div className="flex justify-between">
                  <span className="text-gray-300">Privacy Address:</span>
                  <span className="text-purple-400 font-mono text-xs">
                    {railgunAddress.slice(0, 6)}...{railgunAddress.slice(-4)}
                  </span>
                </div>
              )}
              {railgunError && (
                <div className="text-red-400 text-sm mt-2">
                  Error: {railgunError}
                </div>
              )}
            </div>
          </div>

          {/* Network Switcher */}
          <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-white mb-2">Network</h3>
            <div className="space-y-3">
              <div className="text-sm text-gray-300">Current: {getCurrentNetwork()?.name || 'Unknown'}</div>
              <select
                value={chainId || ''}
                onChange={(e) => switchNetwork(parseInt(e.target.value))}
                className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              >
                <option value={1}>Ethereum</option>
                <option value={137}>Polygon</option>
                <option value={42161}>Arbitrum</option>
                <option value={56}>BSC</option>
              </select>
            </div>
          </div>
        </div>

        {/* Main Content Tabs */}
        <div className="bg-black/20 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
          {/* Tab Navigation */}
          <div className="border-b border-white/10">
            <nav className="flex">
              {[
                { id: 'overview', label: 'Overview', icon: '📊' },
                { id: 'privacy', label: 'Privacy Actions', icon: '🔒' },
                { id: 'history', label: 'Transaction History', icon: '📜' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-6 py-4 font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'text-purple-400 border-b-2 border-purple-400'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'overview' && (
              <div className="space-y-6">
                {/* Wallet Info */}
                <div className="bg-gray-800/50 rounded-xl p-6">
                  <h3 className="text-xl font-semibold text-white mb-4">Wallet Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-gray-300 text-sm">Public Address</label>
                      <div className="text-white font-mono bg-gray-700 rounded p-2 mt-1">
                        {address}
                      </div>
                    </div>
                    <div>
                      <label className="text-gray-300 text-sm">Network</label>
                      <div className="text-white bg-gray-700 rounded p-2 mt-1">
                        {getCurrentNetwork()?.name || 'Unknown'}
                      </div>
                    </div>
                    {railgunAddress && (
                      <div className="md:col-span-2">
                        <label className="text-gray-300 text-sm">Railgun Privacy Address</label>
                        <div className="text-purple-400 font-mono bg-gray-700 rounded p-2 mt-1">
                          {railgunAddress}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Public Balances */}
                <div className="bg-gray-800/50 rounded-xl p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold text-white">Public Balances</h3>
                    <button
                      onClick={refreshAllBalances}
                      disabled={isLoadingBalances}
                      className="text-blue-400 hover:text-blue-300 text-sm disabled:opacity-50"
                    >
                      {isLoadingBalances ? '🔄 Refreshing...' : '🔄 Refresh'}
                    </button>
                  </div>
                  
                  {isLoadingBalances ? (
                    <div className="flex justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
                    </div>
                  ) : publicBalances && publicBalances.length > 0 ? (
                    <div className="space-y-3">
                      {publicBalances.map((token, index) => (
                        <div key={index} className="flex justify-between items-center p-3 bg-gray-700/50 rounded-lg">
                          <div className="flex items-center space-x-3">
                            <div className="text-2xl">{token.symbol === 'ETH' ? '🚀' : '🪙'}</div>
                            <div>
                              <div className="text-white font-medium">{token.symbol}</div>
                              <div className="text-gray-400 text-sm">{token.name}</div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-white font-medium">
                              {formatBalance(token.balance, token.decimals)}
                            </div>
                            {token.usdValue && (
                              <div className="text-gray-400 text-sm">
                                ${token.usdValue.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-400">
                      No tokens found or balances not loaded
                    </div>
                  )}
                </div>

                {/* Private Balances (Railgun) */}
                {canUseRailgun && (
                  <div className="bg-gray-800/50 rounded-xl p-6">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-xl font-semibold text-white">Private Balances (Railgun)</h3>
                      <button
                        onClick={refreshAllBalances}
                        disabled={isLoadingBalances}
                        className="text-purple-400 hover:text-purple-300 text-sm disabled:opacity-50"
                      >
                        {isLoadingBalances ? '🔄 Refreshing...' : '🔄 Refresh'}
                      </button>
                    </div>
                    
                    {isLoadingBalances ? (
                      <div className="flex justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
                      </div>
                    ) : privateBalances && privateBalances.length > 0 ? (
                      <div className="space-y-3">
                        {privateBalances.map((token, index) => (
                          <div key={index} className="flex justify-between items-center p-3 bg-purple-900/20 border border-purple-500/30 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <div className="text-2xl">🔒</div>
                              <div>
                                <div className="text-white font-medium">{token.symbol}</div>
                                <div className="text-gray-400 text-sm">Private • {token.name}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-purple-400 font-medium">
                                {formatBalance(token.balance, token.decimals)}
                              </div>
                              {token.usdValue && (
                                <div className="text-gray-400 text-sm">
                                  ${token.usdValue.toFixed(2)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-6 text-gray-400">
                        <div className="text-purple-400 mb-2">🔒 No private tokens yet</div>
                        <p className="text-sm">Shield tokens from your public wallet to see private balances</p>
                      </div>
                    )}
                  </div>
                )}

                {canUseRailgun && (
                  <div className="bg-green-900/20 border border-green-500/30 rounded-xl p-4">
                    <h3 className="text-green-400 font-semibold mb-2">🎉 Privacy Ready!</h3>
                    <p className="text-green-300">
                      Your RAILGUN privacy wallet is initialized and ready for private transactions.
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'privacy' && (
              <div>
                {canUseRailgun ? (
                  <PrivacyActions />
                ) : (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">🔄</div>
                    <h3 className="text-xl font-semibold text-white mb-2">
                      {isInitializingRailgun ? 'Setting up privacy...' : 'Privacy Not Available'}
                    </h3>
                    <p className="text-gray-300">
                      {isInitializingRailgun 
                        ? 'Please wait while we initialize your privacy wallet.'
                        : 'RAILGUN privacy features are not available.'
                      }
                    </p>
                    {railgunError && (
                      <div className="mt-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                        <p className="text-red-400">{railgunError}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'history' && (
              <div>
                <TransactionHistory />
              </div>
            )}
          </div>
        </div>

        {/* Debug Info */}
        <div className="mt-8">
          <button
            onClick={() => setShowDebugInfo(!showDebugInfo)}
            className="text-gray-400 hover:text-white text-sm underline"
          >
            {showDebugInfo ? 'Hide' : 'Show'} Debug Info
          </button>
          
          {showDebugInfo && (
            <div className="mt-4 bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-4">
              <h4 className="text-white font-semibold mb-2">Debug Information</h4>
              <pre className="text-gray-300 text-xs overflow-auto">
                {JSON.stringify(getConnectionDebugInfo(), null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WalletPage; 