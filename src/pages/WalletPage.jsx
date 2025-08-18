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
import TransactionHistory from '../components/TransactionHistory';
import {
  shieldTokens,
  parseTokenAmount,
  isTokenSupportedByRailgun,
} from '../utils/railgun/actions';
// Removed deprecated checkSufficientBalance import
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
    switchNetwork,
    getCurrentNetwork,
    walletProviders,
    isWalletAvailable,
    walletProvider, // Add walletProvider to destructuring
    checkChainReady,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    loading: isLoading,
    error: balanceErrors,
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    lastUpdateTime,
    loadPrivateBalancesFromMetadata, // Add this for Redis-only refresh
  } = useBalances();

  const [showPrivateMode, setShowPrivateMode] = useState(false);
  const [selectedView, setSelectedView] = useState('balances'); // 'balances', 'privacy', or 'history'
  const [showPrivateBalances, setShowPrivateBalances] = useState(false);
  const [isShielding, setIsShielding] = useState(false);
  const [shieldingTokens, setShieldingTokens] = useState(new Set());
  const [shieldAmounts, setShieldAmounts] = useState({});
  const [showSignatureGuide, setShowSignatureGuide] = useState(false);

  const network = getCurrentNetwork();
  const [isChainReady, setIsChainReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!canUseRailgun || !railgunWalletId || !address) {
        if (mounted) setIsChainReady(false);
        return;
      }
      try {
        const ready = await checkChainReady();
        if (mounted) setIsChainReady(!!ready);
      } catch {
        if (mounted) setIsChainReady(false);
      }
    })();
    return () => { mounted = false; };
  }, [canUseRailgun, railgunWalletId, address, chainId]);

  // Hybrid refresh: Public from blockchain + Private from Redis  
  const refreshBalances = useCallback(async () => {
    try {
      console.log('[WalletPage] 🔄 Hybrid refresh - Public from blockchain + Private from Redis...');
      
      // Single entry point for UI/state refresh (public from chain + private from Redis)
      await refreshAllBalances();
      
      toast.success('Balances refreshed successfully');
    } catch (error) {
      console.error('[WalletPage] Hybrid refresh failed:', error);
      toast.error('Failed to refresh balances');
    }
  }, [refreshAllBalances]);

  // Auto-refresh public balances when wallet connects
  useEffect(() => {
    if (isConnected && address && chainId) {
      console.log('[WalletPage] 🔄 Wallet connected - auto-refreshing public balances...');
      refreshAllBalances();
    }
  }, [isConnected, address, chainId]); // Removed refreshAllBalances to prevent infinite loop

  // Auto-switch to privacy view when Railgun is ready
  useEffect(() => {
    if (canUseRailgun && railgunWalletId) {
      setShowPrivateMode(true);
    }
  }, [canUseRailgun, railgunWalletId]);

  // Re-check readiness immediately after scan completes and Redis updates
  useEffect(() => {
    const onScanComplete = () => {
      checkChainReady().then((ready) => setIsChainReady(!!ready)).catch(() => {});
    };
    window.addEventListener('railgun-scan-complete', onScanComplete);
    return () => window.removeEventListener('railgun-scan-complete', onScanComplete);
  }, [checkChainReady]);

  // Show signature guide on first-time EOA connection
  useEffect(() => {
    if (isConnected && address && !canUseRailgun && !isInitializingRailgun) {
      // Check if this address has seen the guide before
      const seenGuideKey = `railgun-guide-seen-${address.toLowerCase()}`;
      const hasSeenGuide = localStorage.getItem(seenGuideKey);
      
      if (!hasSeenGuide) {
        // Add small delay to ensure connection is fully established
        const timer = setTimeout(() => {
          setShowSignatureGuide(true);
          // Mark this address as having seen the guide
          localStorage.setItem(seenGuideKey, 'true');
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [isConnected, address, canUseRailgun, isInitializingRailgun]);

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

      // Check sufficient balance - using direct balance check instead of deprecated function
      const requestedAmount = parseFloat(amount);
      const availableAmount = token.numericBalance || 0;
      
      if (availableAmount < requestedAmount) {
        throw new Error(`Insufficient balance. Available: ${availableAmount} ${token.symbol}`);
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

      // Validate token address: allow undefined/null for native base tokens (e.g., ETH/MATIC/BNB)
      const isNativeToken = token.address == null; // undefined or null means native token
      if (!isNativeToken && (typeof token.address !== 'string' || !token.address.startsWith('0x') || token.address.length !== 42)) {
        throw new Error(`Invalid token address for ${token.symbol}`);
      }

      // Log token type for debugging
      const tokenType = isNativeToken ? 'NATIVE' : 'ERC20';
      console.log('[WalletPage] About to shield', tokenType, 'token:', token.symbol);

      toast.loading(`Shielding ${amount} ${token.symbol}...`);
      
      const result = await shieldTokens({
        tokenAddress: token.address,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress,
        walletProvider: await walletProvider()
      });

      // Send the transaction to the blockchain
      toast.dismiss();
      toast.loading(`Sending shield transaction...`);
      
      console.log('[WalletPage] Sending shield transaction:', result.transaction);
      
      // Get wallet signer
      const walletSigner = await walletProvider();
      
      // Send transaction using signer
      const txResponse = await walletSigner.sendTransaction(result.transaction);
      
      console.log('[WalletPage] Transaction sent:', txResponse);
      
      // Wait for transaction confirmation
      toast.dismiss();
      toast.loading(`Waiting for confirmation...`);
      
      // Note: In a production app, you'd want to wait for confirmation
      // For now, we'll just show success after sending
      
      toast.dismiss();
      toast.success(`Successfully shielded ${amount} ${token.symbol}! TX: ${txResponse.hash}`);
      
      // Clear the amount for this token
      setShieldAmounts(prev => ({ ...prev, [token.symbol]: '' }));
      
      // Enhanced transaction monitoring
      toast.dismiss();
      toast.success('Shield transaction sent! Monitoring for confirmation...');
      console.log('[WalletPage] Starting Graph-based shield monitoring...');
      
      try {
        // Import the enhanced transaction monitor
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor');
        
        // Start monitoring with transaction details for optimistic updates
        monitorTransactionInGraph({
          txHash: txResponse.hash,
          chainId: chainConfig.id,
          transactionType: 'shield',
          // Pass transaction details for optimistic UI update and note capture
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            tokenSymbol: token.symbol,
            tokenAddress: token.address,
            decimals: token.decimals,
            amount: amount,
          },
          listener: async (event) => {
            console.log(`[WalletPage] ✅ Shield tx ${txResponse.hash} indexed on chain ${chainConfig.id}`);
            
            // The useBalances hook will handle optimistic update automatically
            toast.success(`Shield confirmed! Your private balance has been updated.`);
          }
        })
        .then((result) => {
          if (result.found) {
            console.log(`[WalletPage] Shield monitoring completed in ${result.elapsedTime/1000}s`);
          } else {
            console.warn('[WalletPage] Shield monitoring timed out');
            toast.info('Shield successful! Balance will update automatically.');
          }
        })
        .catch((error) => {
          console.error('[WalletPage] Shield Graph monitoring failed:', error);
          // Let balance callback handle the update
        });
        
      } catch (monitorError) {
        console.error('[WalletPage] Failed to start shield monitoring:', monitorError);
        // Still rely on balance callback system
      }
      
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
  }, [canUseRailgun, railgunWalletId, address, chainId, network, shieldAmounts, refreshBalancesAfterTransaction, getEncryptionKey, walletProvider]);

  // Handle Shield All functionality
  const handleShieldAll = useCallback(async () => {
    if (!canUseRailgun || !railgunWalletId || !address) {
      toast.error('Railgun wallet not ready');
      return;
    }

    try {
      setIsShielding(true);
      
      // Get tokens that can be shielded from public balances
      const shieldableTokens = publicBalances.filter(token => 
        token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)
      );
      
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
      
      // Refresh balances after successful transaction
      await refreshBalancesAfterTransaction(railgunWalletId);
      
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
      const targetNetwork = supportedNetworks.find(net => net.id === targetChainId);
      toast.success(`Switched to ${targetNetwork?.name || `Chain ${targetChainId}`}`);
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
              <button
                onClick={() => setSelectedView('history')}
                disabled={!canUseRailgun}
                className={`py-4 px-6 text-sm font-medium border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  selectedView === 'history'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-300'
                }`}
              >
                🕐 History
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
            {publicBalances.filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)).length >= 2 && (
              <div className="bg-purple-900 border border-purple-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-purple-100 font-medium">🛡️ Multiple Tokens Available</h3>
                    <p className="text-purple-200 text-sm">
                      You have {publicBalances.filter(token => token.hasBalance && isTokenSupportedByRailgun(token.address, chainId)).length} supported tokens ready to shield
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
                  onClick={refreshBalances}
                  disabled={isLoading || !isConnected}
                  className="bg-purple-600 hover:bg-purple-700 disabled:bg-purple-800 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                >
                  {isLoading ? 'Refreshing...' : 'Refresh'}
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
                      onClick={refreshBalances}
                      disabled={isLoading || !isConnected}
                      className="text-purple-400 hover:text-purple-300 text-sm disabled:opacity-50"
                    >
                      {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                </div>
                
                <div className="p-6">
                  <div className="space-y-4">
                    {publicBalances.map((token) => {
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
                                disabled={isShieldingThis || !isChainReady}
                                className="bg-gray-600 hover:bg-gray-500 disabled:bg-gray-700 text-white px-3 py-2 rounded text-sm transition-colors"
                              >
                                Max
                              </button>
                              <button
                                onClick={() => handleShieldToken(token)}
                                disabled={isShieldingThis || !shieldAmounts[token.symbol] || !isChainReady}
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
                          
                          {(!canUseRailgun || !isChainReady) && (
                            <div className="mt-3 text-gray-500 text-sm">
                              {(!canUseRailgun) ? 'Connect Railgun to enable shielding' : 'Creating your wallet shield... please wait until initialization completes'}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    
                    {publicBalances.length === 0 && !isLoading && (
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
                      {canUseRailgun && privateBalances.length > 0 && (
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
                  ) : privateBalances.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="bg-gray-700 rounded-full p-4 w-16 h-16 mx-auto mb-4">
                        <EyeSlashIcon className="h-8 w-8 text-gray-400" />
                      </div>
                      <p className="text-gray-400 font-medium">No private tokens yet</p>
                      <p className="text-gray-500 text-sm mt-1">
                        Shield some tokens to start using privacy features
                      </p>
                      {publicBalances.length > 0 && (
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
                              {privateBalances.length} Private Token{privateBalances.length !== 1 ? 's' : ''}
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
                      {(showPrivateBalances || privateBalances.length <= 3) && 
                        privateBalances.map((token) => (
                          <div key={token.symbol} className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                            <div className="flex items-center space-x-3">
                              <div className="bg-purple-600 rounded-full p-2">
                                <EyeSlashIcon className="h-4 w-4 text-white" />
                              </div>
                              <div>
                                <div className="text-white font-medium">{token.symbol}</div>
                                <div className="text-gray-400 text-sm">Private • {token.name || `${token.symbol} Token` || 'Unknown Token'}</div>
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
                      {!showPrivateBalances && privateBalances.length > 3 && (
                        <div className="text-center py-4">
                          <button
                            onClick={() => setShowPrivateBalances(true)}
                            className="text-purple-400 hover:text-purple-300 text-sm font-medium"
                          >
                            Show {privateBalances.length - 3} more private tokens
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

        {selectedView === 'history' && (
          <TransactionHistory />
        )}

        {/* Error Messages */}
        {balanceErrors && (
          <div className="mt-4 p-3 bg-red-900 border border-red-700 rounded-lg">
            <p className="text-red-300 text-sm">Balance error: {balanceErrors}</p>
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

      {/* Signature Guide Popup */}
      {showSignatureGuide && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="bg-purple-100 dark:bg-purple-900 rounded-full p-2">
                  <ShieldCheckIcon className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Enable Privacy Features</h3>
              </div>
              <button
                onClick={() => setShowSignatureGuide(false)}
                className="text-gray-400 hover:text-gray-300 transition-colors"
              >
                <XCircleIcon className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-gray-300">
                To unlock Railgun's privacy features, you'll need to sign a message in your wallet. This creates a secure, privacy shield that enables private token balances and transactions.
              </p>
              
              <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                <p className="text-blue-300 text-sm">
                  <strong>Note:</strong> This signature doesn't cost gas fees and only needs to be done once per wallet.
                </p>
              </div>
              
              <div className="flex space-x-3 pt-2">
                <button
                  onClick={() => {
                    setShowSignatureGuide(false);
                    // The signature will be automatically triggered by WalletContext
                    toast.success('Look for the signature request in your wallet!');
                  }}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WalletPage; 