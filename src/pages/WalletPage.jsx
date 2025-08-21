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
  ClipboardDocumentIcon,
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
  // Lexie ID linking state
  const [lexieIdInput, setLexieIdInput] = useState('');
  const [lexieLinking, setLexieLinking] = useState(false);
  const [lexieCode, setLexieCode] = useState('');
  const [lexieNeedsCode, setLexieNeedsCode] = useState(false);
  const [lexieMessage, setLexieMessage] = useState('');
  const [showLexieModal, setShowLexieModal] = useState(false);
  const [currentLexieId, setCurrentLexieId] = useState('');

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

  // Full refresh: SDK refresh + Redis persist, then UI reload (public from chain + private from Redis)
  const refreshBalances = useCallback(async () => {
    try {
      console.log('[WalletPage] 🔄 Full refresh — SDK refresh + Redis persist, then UI fetch...');

      // Step 1: Trigger SDK refresh + persist authoritative balances to Redis
      try {
        if (railgunWalletId && address && chainId) {
          const { syncBalancesAfterTransaction } = await import('../utils/railgun/syncBalances.js');
          await syncBalancesAfterTransaction({
            walletAddress: address,
            walletId: railgunWalletId,
            chainId,
          });
        }
      } catch (sdkErr) {
        console.warn('[WalletPage] ⚠️ SDK refresh + persist failed (continuing to UI refresh):', sdkErr?.message);
      }

      // Step 2: Refresh UI from sources of truth
      await refreshAllBalances();

      toast.success('Balances refreshed successfully');
    } catch (error) {
      console.error('[WalletPage] Full refresh failed:', error);
      toast.error('Failed to refresh balances');
    }
  }, [refreshAllBalances, railgunWalletId, address, chainId]);

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

  // Check if this Railgun address already has a linked Lexie ID
  useEffect(() => {
    if (!railgunAddress) {
      setCurrentLexieId('');
      return;
    }
    (async () => {
      try {
        // Check if this railgun address has a linked Lexie ID
        const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(railgunAddress)}`);
        if (resp.ok) {
          const json = await resp.json().catch(() => ({}));
          if (json.success && json.lexieID) {
            setCurrentLexieId(json.lexieID);
          } else {
            setCurrentLexieId('');
          }
        } else {
          setCurrentLexieId('');
        }
      } catch {
        setCurrentLexieId('');
      }
    })();
  }, [railgunAddress]);

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
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Navigation (same as LandingPage) */}
      <nav className="sticky top-0 z-40 w-full p-6 bg-black">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="text-4xl font-bold text-purple-300">
            LEXIE AI
          </div>
          <div className="hidden md:flex space-x-6">
            <a href="/#features" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Features</a>
            <a href="/#security" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Security</a>
            <a href="/#beta" className="text-lg font-bold text-purple-300 hover:text-white transition-colors">Beta</a>
          </div>
        </div>
      </nav>

      {/* Background overlays (match LandingPage) */}
      <div className="fixed inset-0 z-0">
        {/* Base gradient layers */}
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        {/* Futuristic cityscape silhouette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
        {/* Dynamic grid system */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(147,51,234,0.2)_1px,transparent_1px),linear-gradient(90deg,rgba(147,51,234,0.2)_1px,transparent_1px)] bg-[size:40px_40px] animate-pulse"></div>
          <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.1)_1px,transparent_1px)] bg-[size:80px_80px] animate-pulse" style={{animationDelay: '1s'}}></div>
        </div>
        {/* Subtle ambient orbs */}
        <div className="absolute inset-0 overflow-hidden">
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

      <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Terminal Window */}
        <div className="rounded-xl overflow-hidden shadow-2xl border border-green-500/30 bg-black">
          {/* Terminal chrome */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-green-500/20 bg-black/90">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500/80" />
                <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
                <span className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="text-sm tracking-wide text-green-200 font-mono">lexie-ai</span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400">ONLINE</span>
            </div>
          </div>

          {/* Terminal content */}
          <div className="p-6 font-mono text-green-300 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-green-500/20 pb-4">
              <div>
                <h1 className="text-xl font-bold text-emerald-300">Lexie Secure Vault</h1>
                <div className="flex items-center space-x-2 text-sm">
                  <span className="text-green-400/80">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  <span className="text-green-400/60">•</span>
                  {currentLexieId ? (
                    <div className="flex items-center space-x-2">
                      <span className="text-purple-300 font-medium">@{currentLexieId}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(currentLexieId);
                          toast.success('Lexie ID copied to clipboard!');
                        }}
                        className="inline-flex items-center gap-1 bg-purple-300 hover:bg-purple-400 text-black px-2 py-0.5 rounded text-xs font-medium transition-colors"
                        title="Copy Lexie ID"
                      >
                        <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowLexieModal(true)}
                      className="bg-purple-300 hover:bg-purple-400 text-black px-2 py-0.5 rounded text-xs font-medium transition-colors"
                    >
                      Get a Lexie ID
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <select
                  value={chainId || ''}
                  onChange={(e) => handleNetworkSwitch(parseInt(e.target.value))}
                  className="bg-black text-green-300 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none"
                >
                  {supportedNetworks.map((net) => (
                    <option key={net.id} value={net.id} className="bg-black">
                      {net.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={disconnectWallet}
                  className="bg-black hover:bg-red-900/30 text-red-300 px-3 py-1 rounded text-sm border border-red-500/40"
                >
                  Disconnect
                </button>
              </div>
            </div>

            {/* Boot log */}
            <div className="bg-black/40 border border-green-500/20 rounded p-3">
              <div className="text-xs text-green-300/80 tracking-wide mb-2">LEXIE AI SYSTEM BOOT v2.1.3</div>
              <div className="space-y-1 text-green-200/90 text-xs leading-5">
                <div>✓ Vault interface loaded</div>
                <div>✓ Network: {network?.name || 'Unknown'}</div>
                <div>✓ Public balances: {Array.isArray(publicBalances) ? publicBalances.length : 0}</div>
                <div>✓ Vault balances: {Array.isArray(privateBalances) ? privateBalances.length : 0}</div>
                <div>{canUseRailgun ? '✓ Secure vault online' : '… Initializing secure vault'}</div>
                <div className="pt-1 text-green-300">Ready for commands...</div>
              </div>
            </div>

            {/* Command Panel */}
            <div className="bg-black/40 border border-green-500/20 rounded p-3">
              <div className="text-xs text-green-400/80 mb-2">LEXIE TERMINAL • commands</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={refreshBalances}
                  disabled={isLoading || !isConnected}
                  className="px-2 py-1 rounded border border-emerald-400/40 bg-emerald-900/20 hover:bg-emerald-900/40 disabled:opacity-50 text-xs"
                >
                  refresh
                </button>
                <button
                  onClick={() => setSelectedView('balances')}
                  className="px-2 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 text-xs"
                >
                  balances
                </button>
                <button
                  onClick={() => setSelectedView('privacy')}
                  className="px-2 py-1 rounded border border-green-500/40 bg-black hover:bg-green-900/20 text-xs"
                >
                  add
                </button>
                <button
                  onClick={() => {
                    setSelectedView('privacy');
                    setTimeout(() => {
                      const el = document.querySelector('[data-tab="transfer"]');
                      if (el) el.click();
                    }, 100);
                  }}
                  className="px-2 py-1 rounded border border-cyan-400/40 bg-cyan-900/20 hover:bg-cyan-900/40 text-xs"
                >
                  send
                </button>
                <button
                  onClick={() => {
                    setSelectedView('privacy');
                    setTimeout(() => {
                      const el = document.querySelector('[data-tab="unshield"]');
                      if (el) el.click();
                    }, 100);
                  }}
                  className="px-2 py-1 rounded border border-amber-400/40 bg-amber-900/20 hover:bg-amber-900/40 text-xs"
                >
                  remove
                </button>
                <button
                  onClick={() => setSelectedView('history')}
                  className="px-2 py-1 rounded border border-purple-400/40 bg-purple-900/20 hover:bg-purple-900/40 text-xs"
                >
                  history
                </button>
              </div>
            </div>

            {/* Wallet Balances */}
            {selectedView === 'balances' && (
              <div className="space-y-4">
                {/* Private Balances */}
                <div className="bg-black/40 border border-green-500/20 rounded p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-green-300 text-sm font-medium">Vault Balances</div>
                    <div className="flex items-center space-x-2">
                      <div className="text-emerald-300 text-xs">Railgun</div>
                      {canUseRailgun && privateBalances.length > 0 && (
                        <button
                          onClick={() => setShowPrivateBalances(!showPrivateBalances)}
                          className={`px-2 py-0.5 rounded text-xs border ${
                            showPrivateBalances 
                              ? 'bg-emerald-600/30 text-emerald-200 border-emerald-400/40' 
                              : 'bg-black text-green-300 hover:bg-green-900/20 border-green-500/40'
                          }`}
                        >
                          {showPrivateBalances ? 'Hide' : 'Show'}
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {!canUseRailgun ? (
                    <div className="text-center py-4 text-green-400/70 text-xs">
                      Secure vault engine not ready
                    </div>
                  ) : privateBalances.length === 0 ? (
                    <div className="text-center py-4 text-green-300 text-xs">
                      No vault tokens yet
                      <div className="text-green-400/70 mt-1">Add some tokens to start using secure vault</div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="text-green-200 text-xs">
                        {privateBalances.length} Vault Token{privateBalances.length !== 1 ? 's' : ''}
                      </div>

                      {(showPrivateBalances || privateBalances.length <= 3) && 
                        privateBalances.map((token) => (
                          <div key={token.symbol} className="flex items-center justify-between p-2 bg-black/60 rounded text-xs">
                            <div className="flex items-center space-x-2">
                              <div className="text-green-200 font-medium">{token.symbol}</div>
                              <div className="text-green-400/70">Vault • {token.name || `${token.symbol} Token` || 'Unknown Token'}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-green-200">{token.formattedBalance}</div>
                              <div className="text-green-400/70">${token.balanceUSD}</div>
                            </div>
                          </div>
                        ))
                      }

                      {!showPrivateBalances && privateBalances.length > 3 && (
                        <div className="text-center py-2">
                          <button
                            onClick={() => setShowPrivateBalances(true)}
                            className="text-emerald-300 hover:text-emerald-200 text-xs"
                          >
                            Show {privateBalances.length - 3} more vault tokens
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Public Balances */}
                <div className="bg-black/40 border border-green-500/20 rounded p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-green-300 text-sm font-medium">Public Balances</div>
                    <button
                      onClick={refreshBalances}
                      disabled={isLoading || !isConnected}
                      className="text-emerald-400 hover:text-emerald-300 text-xs disabled:opacity-50"
                    >
                      {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    {publicBalances.map((token) => {
                      const isSupported = isTokenSupportedByRailgun(token.address, chainId);
                      const isShieldingThis = shieldingTokens.has(token.symbol);
                      
                      return (
                        <div key={token.symbol} className="flex items-center justify-between p-2 bg-black/60 rounded text-xs">
                          <div className="flex items-center space-x-2">
                            <div className="text-green-200 font-medium">{token.symbol}</div>
                            <div className="text-green-400/70">{token.name}</div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <div className="text-right">
                              <div className="text-green-200">{token.formattedBalance}</div>
                              <div className="text-green-400/70">${token.balanceUSD}</div>
                            </div>
                            {canUseRailgun && isSupported && token.hasBalance && (
                              <div className="flex items-center space-x-1">
                                <input
                                  type="number"
                                  placeholder="Amount"
                                  value={shieldAmounts[token.symbol] || ''}
                                  onChange={(e) => setShieldAmounts(prev => ({
                                    ...prev,
                                    [token.symbol]: e.target.value
                                  }))}
                                  disabled={isShieldingThis}
                                  className="w-20 bg-black text-green-200 rounded px-1 py-0.5 text-xs border border-green-500/40 focus:border-emerald-400 focus:outline-none"
                                />
                                <button
                                  onClick={() => setShieldAmounts(prev => ({
                                    ...prev,
                                    [token.symbol]: token.numericBalance.toString()
                                  }))}
                                  disabled={isShieldingThis || !isChainReady}
                                  className="bg-black hover:bg-green-900/20 disabled:bg-black/40 text-green-200 px-1 py-0.5 rounded text-xs border border-green-500/40"
                                >
                                  Max
                                </button>
                                <button
                                  onClick={() => handleShieldToken(token)}
                                  disabled={isShieldingThis || !shieldAmounts[token.symbol] || !isChainReady}
                                  className="bg-emerald-600/30 hover:bg-emerald-600/50 disabled:bg-black/40 text-emerald-200 px-2 py-0.5 rounded text-xs border border-emerald-400/40"
                                >
                                  {isShieldingThis ? 'Adding…' : 'Add to Vault'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    
                    {publicBalances.length === 0 && !isLoading && (
                      <div className="text-center py-4 text-green-400/70 text-xs">No tokens found</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Privacy Actions */}
            {selectedView === 'privacy' && (
              <div className="bg-black/40 border border-green-500/20 rounded p-3">
                <div className="text-green-300 text-sm font-medium mb-2">Privacy Actions</div>
                <PrivacyActions />
              </div>
            )}

            {/* Transaction History */}
            {selectedView === 'history' && (
              <div className="bg-black/40 border border-green-500/20 rounded p-3">
                <div className="text-green-300 text-sm font-medium mb-2">Transaction History</div>
                <TransactionHistory />
              </div>
            )}
          </div>
          
          {/* Terminal footer status bar */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-green-500/20 bg-black/90 text-xs font-mono">
            <div className="flex items-center gap-4 text-green-300/80">
              <span>Process: lexie-vault</span>
              <span>•</span>
              <span>Status: {canUseRailgun ? 'Active' : 'Idle'}</span>
            </div>
            <div className="text-emerald-400">Connected</div>
          </div>
        </div>

        {/* Error Messages */}
        {balanceErrors && (
          <div className="mt-4 p-3 bg-red-900/20 border border-red-500/40 rounded-lg">
            <p className="text-red-300 text-sm">Balance error: {balanceErrors}</p>
          </div>
        )}

        {/* Last Update Time */}
        {lastUpdateTime && (
          <div className="mt-6 text-center">
            <p className="text-green-500/70 text-xs font-mono">
              Last updated: {new Date(lastUpdateTime).toLocaleTimeString()}
            </p>
          </div>
        )}

      </div>

      {/* Lexie ID Modal */}
      {showLexieModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 font-mono">
          <div className="bg-black border border-green-500/40 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            {/* Modal Terminal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-green-500/20 bg-black/90">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/80" />
                  <span className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <span className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <span className="text-sm tracking-wide text-green-200">lexie-id-setup</span>
              </div>
              <button
                onClick={() => {
                  setShowLexieModal(false);
                  setLexieNeedsCode(false);
                  setLexieCode('');
                  setLexieMessage('');
                  setLexieIdInput('');
                }}
                className="text-green-400/70 hover:text-green-300 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 text-green-300 space-y-4">
              <div>
                <h3 className="text-lg font-bold text-emerald-300 mb-2">Get Your Lexie ID</h3>
                <p className="text-green-400/80 text-sm">
                  Link your Railgun wallet to a Lexie ID for easy identification and social features.
                </p>
              </div>

              {canUseRailgun && railgunAddress ? (
                <div className="space-y-4">
                  <div className="bg-black/40 border border-green-500/20 rounded p-3">
                    <div className="text-green-400/80 text-xs mb-2">Enter your Lexie ID:</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={lexieIdInput}
                        onChange={(e) => setLexieIdInput(e.target.value)}
                        placeholder="e.g. mkmillions"
                        className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none flex-1"
                        disabled={lexieLinking}
                      />
                      {!lexieNeedsCode ? (
                        <button
                          onClick={async () => {
                            try {
                              setLexieMessage('');
                              setLexieLinking(true);
                              const chosen = (lexieIdInput || '').trim().toLowerCase();
                              if (!chosen || chosen.length < 3) {
                                setLexieMessage('Please enter a valid Lexie ID (3-20 chars).');
                                setLexieLinking(false);
                                return;
                              }
                              // Check status
                              const statusResp = await fetch(`/api/wallet-metadata?action=lexie-status&lexieID=${encodeURIComponent(chosen)}`, { method: 'GET' });
                              if (!statusResp.ok) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                              const statusJson = await statusResp.json();
                              if (!statusJson.success) { setLexieMessage('Failed to check Lexie ID status.'); setLexieLinking(false); return; }
                              const exists = !!statusJson.exists; const linked = !!statusJson.linked;
                              if (!exists) {
                                setLexieMessage('This Lexie ID does not exist yet. Please claim it via Telegram.');
                                setLexieLinking(false);
                                return;
                              }
                              if (linked) { setLexieMessage('This ID is taken. Please try another one.'); setLexieLinking(false); return; }
                              // Start linking
                              const startResp = await fetch('/api/wallet-metadata?action=lexie-link-start', {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ lexieID: chosen, railgunAddress })
                              });
                              const startJson = await startResp.json().catch(() => ({}));
                              if (startResp.status === 404) { setLexieMessage('Lexie ID not found. Please claim it via Telegram.'); setLexieLinking(false); return; }
                              if (!startResp.ok || !startJson.success) { setLexieMessage('Failed to start verification.'); setLexieLinking(false); return; }
                              setLexieNeedsCode(true); setLexieMessage('We sent a 4‑digit code to your Telegram. Enter it below to confirm.');
                            } catch (_) { setLexieMessage('Unexpected error starting Lexie link.'); } finally { setLexieLinking(false); }
                          }}
                          disabled={lexieLinking || !lexieIdInput}
                          className="bg-emerald-600/30 hover:bg-emerald-600/50 disabled:bg-black/40 text-emerald-200 px-3 py-1 rounded text-sm border border-emerald-400/40"
                        >
                          {lexieLinking ? 'Working...' : 'Add'}
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={lexieCode}
                            onChange={(e) => setLexieCode(e.target.value)}
                            placeholder="4-digit code"
                            className="bg-black text-green-200 rounded px-2 py-1 text-sm border border-green-500/40 focus:border-emerald-400 focus:outline-none w-20"
                            disabled={lexieLinking}
                          />
                          <button
                            onClick={async () => {
                              try {
                                setLexieLinking(true); setLexieMessage('');
                                const chosen = (lexieIdInput || '').trim().toLowerCase();
                                const verifyResp = await fetch('/api/wallet-metadata?action=lexie-link-verify', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ lexieID: chosen, code: (lexieCode || '').trim() })
                                });
                                const json = await verifyResp.json().catch(() => ({}));
                                if (!verifyResp.ok || !json.success) { setLexieMessage('Verification failed. Check the code and try again.'); return; }
                                setLexieNeedsCode(false); setLexieCode(''); setLexieMessage('✅ Linked successfully to your Railgun wallet.');
                                setCurrentLexieId(chosen);
                                setTimeout(() => {
                                  setShowLexieModal(false);
                                  setLexieIdInput('');
                                  setLexieMessage('');
                                }, 2000);
                              } catch (_) { setLexieMessage('Unexpected verification error.'); } finally { setLexieLinking(false); }
                            }}
                            disabled={lexieLinking || !lexieCode}
                            className="bg-green-600/30 hover:bg-green-600/50 disabled:bg-black/40 text-green-200 px-2 py-1 rounded text-sm border border-green-400/40"
                          >
                            Verify
                          </button>
                          <button
                            onClick={() => { setLexieNeedsCode(false); setLexieCode(''); setLexieMessage(''); }}
                            className="bg-gray-600/30 hover:bg-gray-500/30 text-gray-300 px-2 py-1 rounded text-sm border border-gray-500/40"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                    {lexieMessage && <div className="mt-2 text-xs text-green-300/80">{lexieMessage}</div>}
                  </div>

                  {/* Instructions */}
                  <div className="bg-purple-900/20 border border-purple-500/40 rounded p-3">
                    <div className="text-purple-300 text-xs font-medium mb-2">Don't have a Lexie ID?</div>
                    <p className="text-purple-200/80 text-xs mb-3">
                      Check Lexie on Telegram to claim your unique Lexie ID:
                    </p>
                    <div className="flex items-center space-x-2">
                      <a
                        href="https://t.me/lexie_crypto_bot"
                        target="_blank"
                        rel="noreferrer"
                        className="bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 px-3 py-1 rounded text-xs border border-purple-400/40 transition-colors"
                      >
                        Open Telegram Bot
                      </a>
                      <span className="text-purple-300/60 text-xs">→ Use /lex command</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-900/20 border border-yellow-500/40 rounded p-3">
                  <div className="text-yellow-300 text-xs">
                    Please connect your Railgun wallet first to link a Lexie ID.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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