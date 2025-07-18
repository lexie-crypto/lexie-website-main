/**
 * Wallet Page - Main wallet interface with privacy features
 * Integrates external wallet connection and Railgun privacy functionality
 */

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { 
  WalletIcon, 
  ArrowRightIcon, 
  EyeIcon, 
  EyeSlashIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import PrivacyActions from '../components/PrivacyActions';
import {
  shieldTokens,
  parseTokenAmount,
} from '../utils/railgun/actions';
import { 
  isTokenSupportedByRailgun,
  getShieldableTokens,
} from '../utils/railgun/balances';
import { checkSufficientBalance } from '../utils/web3/balances';
import { deriveEncryptionKey } from '../utils/railgun/wallet';

const WalletPage = () => {
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
    connectWallet,
    disconnectWallet,
    getCurrentNetwork,
    walletProviders,
    isWalletAvailable,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    isLoading,
    balanceErrors,
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    lastUpdateTime,
  } = useBalances();

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [selectedView, setSelectedView] = useState('balances'); // 'balances' or 'privacy'
  const [showPrivateBalances, setShowPrivateBalances] = useState(false);
  const [isShielding, setIsShielding] = useState(false);
  const [shieldingTokens, setShieldingTokens] = useState(new Set());
  const [shieldAmounts, setShieldAmounts] = useState({});

  const network = getCurrentNetwork();

  // Auto-switch to privacy view when Railgun is ready
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      setShowPrivateMode(true);
    }
  }, [canUseRailgun, railgunWalletId]);

  // Get encryption key
  const getEncryptionKey = useCallback(async () => {
    if (!address || !chainId) {
      throw new Error('Wallet not connected');
    }
    
    try {
      const salt = `lexie-railgun-${address.toLowerCase()}-${chainId}`;
      return await deriveEncryptionKey(address.toLowerCase(), salt);
    } catch (error) {
      console.error('[WalletPage] Failed to derive encryption key:', error);
      throw new Error('Failed to derive encryption key');
    }
  }, [address, chainId]);

  // Handle individual token shielding
  const handleShieldToken = useCallback(async (token) => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    const amount = shieldAmounts[token.symbol] || '';
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount to shield');
      return;
    }

    try {
      setIsShielding(true);
      setShieldingTokens(prev => new Set([...prev, token.symbol]));
      
      // Validate token is supported by Railgun
      if (!isTokenSupportedByRailgun(token.address, chainId)) {
        throw new Error(`${token.symbol} is not supported by Railgun on this network`);
      }

      // Check sufficient balance
      const balanceCheck = await checkSufficientBalance(
        address,
        token.address,
        amount,
        chainId
      );

      if (!balanceCheck.hasSufficient) {
        throw new Error(`Insufficient balance. Available: ${balanceCheck.available} ${token.symbol}`);
      }

      // Parse amount to smallest units
      const amountInUnits = parseTokenAmount(amount, token.decimals);

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Execute shield operation with enhanced logging
      console.log('[WalletPage] About to call shieldTokens with:', {
        railgunWalletId: railgunWalletId ? `${railgunWalletId.slice(0, 8)}...` : 'MISSING',
        hasKey: !!key,
        tokenAddress: token.address,
        tokenDetails: {
          symbol: token.symbol,
          address: token.address,
          hasAddress: !!token.address,
          addressType: typeof token.address,
          addressLength: token.address ? token.address.length : 0
        },
        amountInUnits,
        chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress ? `${railgunAddress.slice(0, 8)}...` : 'MISSING'
      });

      // Validate token address before calling shield (allow null for native tokens)
      if (token.address === undefined) {
        throw new Error(`Token ${token.symbol} has no address property`);
      }
      
      // Log token type for debugging
      const tokenType = token.address === null ? 'NATIVE' : 'ERC20';
      console.log('[WalletPage] About to shield', tokenType, 'token:', token.symbol);

      toast.loading(`Shielding ${amount} ${token.symbol}...`);
      
      const result = await shieldTokens(
        railgunWalletId,
        key,
        token.address,
        amountInUnits,
        chainConfig,
        address,
        railgunAddress
      );

      toast.dismiss();
      toast.success(`Successfully shielded ${amount} ${token.symbol}!`);
      
      // Clear the amount for this token
      setShieldAmounts(prev => ({ ...prev, [token.symbol]: '' }));
      
      // Refresh balances after successful transaction
      await refreshBalancesAfterTransaction();
      
    } catch (error) {
      console.error('[WalletPage] Shield failed:', error);
      toast.dismiss();
      toast.error(`Shield failed: ${error.message}`);
    } finally {
      setIsShielding(false);
      setShieldingTokens(prev => {
        const newSet = new Set(prev);
        newSet.delete(token.symbol);
        return newSet;
      });
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, shieldAmounts, refreshBalancesAfterTransaction, getEncryptionKey]);

  // Handle Shield All functionality
  const handleShieldAll = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    try {
      setIsShielding(true);
      
      // Get shieldable tokens
      const shieldableTokens = await getShieldableTokens(address, chainId);
      
      if (shieldableTokens.length === 0) {
        toast.error('No tokens available to shield');
        return;
      }

      // Filter out dust balances and prepare tokens
      const tokensToShield = shieldableTokens
        .filter(token => token.numericBalance > 0.001 && isTokenSupportedByRailgun(token.address, chainId))
        .map(token => ({
          address: token.address,
          amount: parseTokenAmount(token.numericBalance.toString(), token.decimals),
          symbol: token.symbol,
        }));

      if (tokensToShield.length === 0) {
        toast.error('No supported tokens with sufficient balance to shield');
        return;
      }

      // Get chain configuration
      const chainConfig = { type: network.name.toLowerCase(), id: chainId };

      // Get encryption key
      const key = await getEncryptionKey();

      // Shield All functionality temporarily disabled
      toast.error('Shield All functionality not available in current version');
      return;
      
      // const result = await shieldAllTokens(
      //   railgunWalletId,
      //   key,
      //   tokensToShield,
      //   chainConfig,
      //   address,
      //   railgunAddress
      // );

      toast.dismiss();
      
      // if (result.success) {
      //   toast.success(`Successfully shielded all ${tokensToShield.length} tokens!`);
      // } else {
      //   toast.error(`Shield All completed with ${result.summary.failed} failures`);
      // }
      
      // Refresh balances after successful transaction
      await refreshBalancesAfterTransaction();
      
    } catch (error) {
      console.error('[WalletPage] Shield All failed:', error);
      toast.dismiss();
      toast.error(`Shield All failed: ${error.message}`);
    } finally {
      setIsShielding(false);
    }
  }, [canUseRailgun, railgunWalletId, address, chainId, network, refreshBalancesAfterTransaction, getEncryptionKey]);

  const handleNetworkSwitch = async (targetChainId) => {
    try {
      await switchNetwork(targetChainId);
      toast.success(`Switched to ${getCurrentNetwork()?.name}`);
    } catch (error) {
      toast.error(`Failed to switch network: ${error.message}`);
    }
  };

  const supportedNetworks = [
    { id: 1, name: 'Ethereum', symbol: 'ETH' },
    { id: 137, name: 'Polygon', symbol: 'MATIC' },
    { id: 42161, name: 'Arbitrum', symbol: 'ETH' },
    { id: 56, name: 'BSC', symbol: 'BNB' },
  ];

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gray-900 py-12">
        <div className="max-w-md mx-auto text-center">
          <div className="bg-gray-800 rounded-lg shadow-lg p-8">
            <WalletIcon className="h-16 w-16 text-purple-500 mx-auto mb-6" />
            <h1 className="text-2xl font-bold text-white mb-4">Connect Wallet</h1>
            <p className="text-gray-300 mb-8">
              Connect your wallet to access Lexie's privacy features powered by Railgun.
            </p>
            
            <div className="space-y-4">
              {/* MetaMask */}
              <button
                onClick={() => connectWallet('metamask')}
                disabled={isConnecting}
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
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 px-6 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
              >
                <span>🔗</span>
                <span>{isConnecting ? 'Connecting...' : 'WalletConnect'}</span>
              </button>
            </div>

            <div className="mt-4 text-sm text-gray-400 text-center">
              <p>Choose your preferred wallet to connect</p>
              <p className="mt-1 text-xs">Clean wagmi-based connection system</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="bg-purple-600 rounded-full p-3">
                <WalletIcon className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Lexie Privacy Wallet</h1>
                <p className="text-gray-300">
                  {address?.slice(0, 6)}...{address?.slice(-4)} • {network?.name || 'Unknown Network'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Network Selector */}
              <div className="relative">
                <select
                  value={chainId || ''}
                  onChange={(e) => handleNetworkSwitch(parseInt(e.target.value))}
                  className="bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:border-purple-500 focus:outline-none"
                >
                  {supportedNetworks.map((net) => (
                    <option key={net.id} value={net.id}>
                      {net.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Privacy Mode Toggle */}
              <button
                onClick={() => setShowPrivateMode(!showPrivateMode)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors ${
                  showPrivateMode 
                    ? 'bg-purple-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {showPrivateMode ? (
                  <EyeSlashIcon className="h-5 w-5" />
                ) : (
                  <EyeIcon className="h-5 w-5" />
                )}
                <span>Privacy Mode</span>
              </button>

              <button
                onClick={disconnectWallet}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>

        {/* Railgun Status */}
        <div className="bg-gray-800 rounded-lg shadow-lg p-6 mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <ShieldCheckIcon className="h-6 w-6 text-purple-500" />
              <div>
                <h3 className="text-lg font-medium text-white">Railgun Privacy Engine</h3>
                <p className="text-gray-300 text-sm">
                  {isInitializingRailgun ? 'Initializing privacy engine...' :
                   canUseRailgun ? 'Privacy features ready' :
                   'Privacy features unavailable'}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {isInitializingRailgun && (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-purple-500" />
              )}
              
              {canUseRailgun ? (
                <CheckCircleIcon className="h-6 w-6 text-green-500" />
              ) : railgunError ? (
                <XCircleIcon className="h-6 w-6 text-red-500" />
              ) : null}
            </div>
          </div>

          {railgunWalletId && (
            <div className="mt-4 p-4 bg-gray-700 rounded-lg">
              <div className="text-sm text-gray-300">
                <div><strong>Railgun Address:</strong> {railgunAddress}</div>
                <div className="text-xs mt-1 text-gray-400">
                  Wallet ID: {railgunWalletId.slice(0, 8)}...{railgunWalletId.slice(-8)}
                </div>
              </div>
            </div>
          )}

          {railgunError && (
            <div className="mt-4 p-3 bg-red-900 border border-red-700 rounded-lg">
              <p className="text-red-300 text-sm">{railgunError}</p>
            </div>
          )}
        </div>

        {/* View Selector */}
        <div className="bg-gray-800 rounded-lg shadow-lg mb-8">
          <div className="border-b border-gray-700">
            <nav className="-mb-px flex">
              <button
                onClick={() => setSelectedView('balances')}
                className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors ${
                  selectedView === 'balances'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Balances
              </button>
              <button
                onClick={() => setSelectedView('privacy')}
                disabled={!canUseRailgun}
                className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedView === 'privacy'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                Privacy Actions
              </button>
            </nav>
          </div>
        </div>

        {/* Privacy Status and Shield All Banner */}
        {showPrivateMode && (
          <div className="mb-6 space-y-4">
            {/* Privacy Engine Status */}
            <div className="bg-green-900 border border-green-700 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-3 h-3 bg-green-400 rounded-full animate-pulse"></div>
                </div>
                <div>
                  <h3 className="text-green-100 font-medium">🟢 Privacy Engine Ready</h3>
                  <p className="text-green-200 text-sm">
                    Railgun wallet active • Address: 
                    <span 
                      className="font-mono ml-1 cursor-help" 
                      title="Your Railgun address starts with '0zk' and provides private transactions. Tokens sent to this address are shielded from public view."
                    >
                      {railgunAddress?.slice(0, 8)}...{railgunAddress?.slice(-6)}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Shield All Banner */}
            {Object.values(publicBalances).filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)).length >= 2 && (
              <div className="bg-purple-900 border border-purple-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-purple-100 font-medium">🛡️ Multiple Tokens Available</h3>
                    <p className="text-purple-200 text-sm">
                      You have {Object.values(publicBalances).filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)).length} supported tokens ready to shield
                    </p>
                  </div>
                  <button
                    onClick={handleShieldAll}
                    disabled={isShielding}
                    className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    {isShielding ? 'Shielding...' : 'Shield All'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {selectedView === 'balances' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Wallet Balances</h2>
              <div className="flex items-center space-x-4">
                {showPrivateMode && (
                  <button
                    onClick={() => setSelectedView('privacy')}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                  >
                    Privacy Actions
                  </button>
                )}
                <button
                  onClick={refreshAllBalances}
                  disabled={isLoading}
                  className="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  {isLoading ? 'Refreshing...' : 'Refresh All'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Public Balances */}
              <div className="bg-gray-800 rounded-lg shadow-lg">
                <div className="p-6 border-b border-gray-700">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-white">Public Balances</h3>
                    <button
                      onClick={refreshAllBalances}
                      disabled={isLoading}
                      className="text-purple-400 hover:text-purple-300 text-sm disabled:opacity-50"
                    >
                      {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="space-y-4">
                    {Object.values(publicBalances).map((token) => {
                      const isSupported = isTokenSupportedByRailgun(token.address, chainId);
                      const isShieldingThis = shieldingTokens.has(token.symbol);
                      
                      return (
                        <div key={token.symbol} className="p-4 bg-gray-700 rounded-lg">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-3">
                              <div className="bg-gray-600 rounded-full p-2">
                                <CurrencyDollarIcon className="h-5 w-5 text-gray-300" />
                              </div>
                              <div>
                                <div className="text-white font-medium">{token.symbol}</div>
                                <div className="text-gray-400 text-sm">{token.name}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-white font-medium">{token.formattedBalance}</div>
                              <div className="text-gray-400 text-sm">${token.balanceUSD}</div>
                            </div>
                          </div>

                          {/* Shield Controls */}
                          {canUseRailgun && isSupported && token.hasBalance && (
                            <div className="flex items-center space-x-2 mt-3">
                              <input
                                type="number"
                                placeholder="Amount to shield"
                                value={shieldAmounts[token.symbol] || ''}
                                onChange={(e) => setShieldAmounts(prev => ({
                                  ...prev,
                                  [token.symbol]: e.target.value
                                }))}
                                disabled={isShieldingThis}
                                className="flex-1 bg-gray-600 text-white rounded px-3 py-2 text-sm border border-gray-500 focus:border-purple-500 focus:outline-none"
                              />
                              <button
                                onClick={() => setShieldAmounts(prev => ({
                                  ...prev,
                                  [token.symbol]: token.numericBalance.toString()
                                }))}
                                disabled={isShieldingThis}
                                className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white px-3 py-2 rounded text-sm transition-colors"
                              >
                                Max
                              </button>
                              <button
                                onClick={() => handleShieldToken(token)}
                                disabled={isShieldingThis || !shieldAmounts[token.symbol]}
                                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-2 rounded text-sm font-medium transition-colors flex items-center space-x-1"
                              >
                                {isShieldingThis ? (
                                  <>
                                    <div className="animate-spin rounded-full h-3 w-3 border-b border-white" />
                                    <span>Shielding...</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheckIcon className="h-4 w-4" />
                                    <span>Shield</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {/* Status Messages */}
                          {canUseRailgun && !isSupported && (
                            <div className="mt-3 text-yellow-400 text-sm">
                              ⚠️ Not supported by Railgun on this network
                            </div>
                          )}
                          
                          {!canUseRailgun && (
                            <div className="mt-3 text-gray-500 text-sm">
                              Connect Railgun to enable shielding
                            </div>
                          )}
                        </div>
                      );
                    })}
                    
                    {Object.keys(publicBalances).length === 0 && !isLoading && (
                      <div className="text-center py-8">
                        <p className="text-gray-400">No tokens found</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Private Balances */}
              <div className="bg-gray-800 rounded-lg shadow-lg">
                <div className="p-6 border-b border-gray-700">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-white">Private Balances</h3>
                    <div className="flex items-center space-x-3">
                      <div className="flex items-center space-x-2">
                        <EyeSlashIcon className="h-5 w-5 text-purple-500" />
                        <span className="text-purple-400 text-sm">Railgun</span>
                      </div>
                      {canUseRailgun && Object.keys(privateBalances).length > 0 && (
                        <button
                          onClick={() => setShowPrivateBalances(!showPrivateBalances)}
                          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                            showPrivateBalances 
                              ? 'bg-purple-600 text-white' 
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {showPrivateBalances ? 'Hide Details' : 'Show Details'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="p-6">
                  {!canUseRailgun ? (
                    <div className="text-center py-8">
                      <ExclamationTriangleIcon className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
                      <p className="text-gray-400">Railgun privacy engine not ready</p>
                      <p className="text-gray-500 text-sm mt-1">
                        Connect your wallet and wait for initialization
                      </p>
                    </div>
                  ) : Object.keys(privateBalances).length === 0 ? (
                    <div className="text-center py-8">
                      <div className="bg-gray-700 rounded-full p-4 w-16 h-16 mx-auto mb-4">
                        <EyeSlashIcon className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-gray-400 font-medium">No private tokens yet</p>
                      <p className="text-gray-500 text-sm mt-1">
                        Shield some tokens to start using privacy features
                      </p>
                      {Object.keys(publicBalances).length > 0 && (
                        <button
                          onClick={() => setSelectedView('privacy')}
                          className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Go to Privacy Actions
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Private Balances Summary */}
                      <div className="bg-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-white font-medium">
                              {Object.keys(privateBalances).length} Private Token{Object.keys(privateBalances).length !== 1 ? 's' : ''}
                            </div>
                            <div className="text-gray-400 text-sm">
                              Total private holdings across all supported tokens
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => setSelectedView('privacy')}
                              className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-2 rounded text-sm font-medium transition-colors"
                            >
                              Privacy Actions
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Individual Private Token Balances */}
                      {(showPrivateBalances || Object.keys(privateBalances).length <= 3) && 
                        Object.values(privateBalances).map((token) => (
                          <div key={token.symbol} className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <div className="bg-purple-600 rounded-full p-2">
                                <EyeSlashIcon className="h-4 w-4 text-white" />
                              </div>
                              <div>
                                <div className="text-white font-medium">{token.symbol}</div>
                                <div className="text-gray-400 text-sm">Private • {token.name || 'Unknown Token'}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-white font-medium">{token.formattedBalance}</div>
                              <div className="text-gray-400 text-sm">${token.balanceUSD}</div>
                            </div>
                          </div>
                        ))
                      }

                      {/* Show collapsed view for many tokens */}
                      {!showPrivateBalances && Object.keys(privateBalances).length > 3 && (
                        <div className="text-center py-4">
                          <button
                            onClick={() => setShowPrivateBalances(true)}
                            className="text-purple-400 hover:text-purple-300 text-sm font-medium"
                          >
                            Show {Object.keys(privateBalances).length - 3} more private tokens
                          </button>
                        </div>
                      )}

                      {/* Privacy Actions Quick Access */}
                      <div className="bg-gray-700 rounded-lg p-4 mt-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-white font-medium text-sm">Quick Actions</div>
                            <div className="text-gray-400 text-xs">
                              Transfer privately or unshield to public
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => {
                                setSelectedView('privacy');
                                // Auto-switch to transfer tab if we have private balances
                                setTimeout(() => {
                                  const transferButton = document.querySelector('[data-tab="transfer"]');
                                  if (transferButton) transferButton.click();
                                }, 100);
                              }}
                              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                            >
                              Transfer
                            </button>
                            <button
                              onClick={() => {
                                setSelectedView('privacy');
                                // Auto-switch to unshield tab
                                setTimeout(() => {
                                  const unshieldButton = document.querySelector('[data-tab="unshield"]');
                                  if (unshieldButton) unshieldButton.click();
                                }, 100);
                              }}
                              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium transition-colors"
                            >
                              Unshield
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedView === 'privacy' && (
          <PrivacyActions />
        )}

        {/* Error Messages */}
        {balanceErrors.public && (
          <div className="mt-4 p-3 bg-red-900 border border-red-700 rounded-lg">
            <p className="text-red-300 text-sm">Public balance error: {balanceErrors.public}</p>
          </div>
        )}
        
        {balanceErrors.private && (
          <div className="mt-4 p-3 bg-red-900 border border-red-700 rounded-lg">
            <p className="text-red-300 text-sm">Private balance error: {balanceErrors.private}</p>
          </div>
        )}

        {/* Last Update Time */}
        {lastUpdateTime && (
          <div className="mt-6 text-center">
            <p className="text-gray-500 text-sm">
              Last updated: {new Date(lastUpdateTime).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WalletPage; 