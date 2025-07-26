/**
 * Privacy Actions Component
 * Provides Shield and Unshield functionality for Railgun privacy wallet
 * Using the new clean Railgun implementation
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import { 
  ShieldCheckIcon, 
  EyeSlashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import {
  shieldTokens,
  unshieldTokens,
  isValidRailgunAddress,
  isTokenSupportedByRailgun,
  getSupportedChainIds,
} from '../utils/railgun/actions';
import { 
  getPrivateBalances,
  parseTokenAmount,
} from '../utils/railgun/balances';
import { 
  createWallet,
  loadWallet,
  deriveEncryptionKey,
  getCurrentWalletID,
  getCurrentWallet,
} from '../utils/railgun/wallet';
import { initializeRailgun } from '../utils/railgun/engine';

const PrivacyActions = () => {
  const {
    isConnected,
    address,
    chainId,
    railgunWalletId,
    railgunAddress,
    canUseRailgun,
    getCurrentNetwork,
    walletProvider,
  } = useWallet();

  const {
    publicBalances,
    privateBalances,
    isLoading,
    refreshAllBalances,
    refreshBalancesAfterTransaction,
    formatBalance,
  } = useBalances();

  // Component state
  const [activeTab, setActiveTab] = useState('shield');
  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [railgunSetupComplete, setRailgunSetupComplete] = useState(false);

  // Available tabs
  const tabs = [
    { 
      id: 'shield', 
      name: 'Shield', 
      icon: ArrowDownIcon,
      description: 'Move tokens into your private balance'
    },
    { 
      id: 'unshield', 
      name: 'Unshield', 
      icon: ArrowUpIcon,
      description: 'Move tokens back to your public wallet'
    },
  ];

  // Initialize Railgun on component mount
  useEffect(() => {
    const setupRailgun = async () => {
      if (isConnected && address && !railgunSetupComplete) {
        try {
          console.log('[PrivacyActions] Initializing Railgun...');
          await initializeRailgun();
          setRailgunSetupComplete(true);
          console.log('[PrivacyActions] Railgun initialized successfully');
        } catch (error) {
          console.error('[PrivacyActions] Failed to initialize Railgun:', error);
          toast.error('Failed to initialize Railgun privacy system');
        }
      }
    };

    setupRailgun();
  }, [isConnected, address, railgunSetupComplete]);

  // Get available tokens based on current tab
  const availableTokens = useMemo(() => {
    if (!isConnected || !chainId) return [];

    if (activeTab === 'shield') {
      // Show public tokens for shielding
      return publicBalances.filter(token => 
        token.hasBalance && 
        isTokenSupportedByRailgun(token.address, chainId)
      );
    } else if (activeTab === 'unshield') {
      // Show private tokens for unshielding
      return privateBalances.filter(token => token.hasBalance);
    }

    return [];
  }, [activeTab, publicBalances, privateBalances, isConnected, chainId]);

  // Reset form when switching tabs
  useEffect(() => {
    setSelectedToken(null);
    setAmount('');
    setRecipientAddress('');
  }, [activeTab]);

  // Auto-select first available token
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      setSelectedToken(availableTokens[0]);
    }
  }, [availableTokens, selectedToken]);

  // Check if chain is supported
  const isChainSupported = useMemo(() => {
    if (!chainId) return false;
    return getSupportedChainIds().includes(chainId);
  }, [chainId]);

  // Validate amount input
  const isValidAmount = useMemo(() => {
    if (!amount || !selectedToken) return false;
    
    try {
      const numAmount = parseFloat(amount);
      return numAmount > 0 && numAmount <= selectedToken.numericBalance;
    } catch {
      return false;
    }
  }, [amount, selectedToken]);

  // Get encryption key for operations - Use stored signature for consistency
  const getEncryptionKey = useCallback(async () => {
    try {
      if (!address) {
        throw new Error('No wallet address available');
      }

      // Use the same approach as WalletContext - check for stored signature first
      const signatureStorageKey = `railgun-signature-${address.toLowerCase()}`;
      let signature = localStorage.getItem(signatureStorageKey);
      
      if (!signature) {
        // If no stored signature, request one using signer (should only happen on first use)
        if (!walletProvider) {
          throw new Error('No wallet provider available');
        }
        
        console.log('[PrivacyActions] No stored signature found, requesting new signature...');
        const signatureMessage = `RAILGUN Wallet Creation\nAddress: ${address}\n\nSign this message to create your secure RAILGUN privacy wallet.`;
        
        // Get signer and use signMessage (not provider.request)
        const signer = await walletProvider();
        signature = await signer.signMessage(signatureMessage);
        
        // Store signature for future use
        localStorage.setItem(signatureStorageKey, signature);
        console.log('[PrivacyActions] Signature stored for future use');
      } else {
        console.log('[PrivacyActions] Using stored signature for encryption key');
      }

      // Generate encryption key using same method as WalletContext
      const { default: CryptoJS } = await import('crypto-js');
      const addressBytes = address.toLowerCase().replace('0x', '');
      const signatureBytes = signature.replace('0x', '');
      const combined = signatureBytes + addressBytes;
      const hash = CryptoJS.SHA256(combined);
      const encryptionKey = hash.toString(CryptoJS.enc.Hex).slice(0, 64);
      
      return encryptionKey;
    } catch (error) {
      console.error('[PrivacyActions] Failed to get encryption key:', error);
      if (error.code === 4001 || error.message.includes('rejected')) {
        throw new Error('Signature required for privacy operations. Please approve the signature request.');
      }
      throw new Error('Failed to get encryption key');
    }
  }, [address, walletProvider]);

  // Handle shield operation
  const handleShield = useCallback(async () => {
    if (!selectedToken || !amount || !isValidAmount || !railgunAddress) {
      return;
    }

    setIsProcessing(true);
    let toastId;

    try {
      toastId = toast.loading('Initializing shield operation...');

      // Get encryption key
      const encryptionKey = await getEncryptionKey();

      // Parse amount to base units
      const amountInUnits = parseTokenAmount(amount, selectedToken.decimals);

      // Get chain configuration
      const chainConfig = { id: chainId };

      console.log('[PrivacyActions] Starting shield operation:', {
        token: selectedToken.symbol,
        amount,
        amountInUnits,
        railgunAddress,
      });

      toast.loading('Shielding tokens into private balance...', { id: toastId });

      // Get wallet signer (not provider to avoid re-wrapping)
      const walletSigner = await walletProvider(); // This now returns a signer
      
      // Execute shield operation
      const result = await shieldTokens({
        tokenAddress: selectedToken.address,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress,
        walletProvider: walletSigner // Pass signer directly
      });

      // Send the transaction to the blockchain
      toast.dismiss(toastId);
      toast.loading('Sending shield transaction...', { id: toastId });
      
      console.log('[PrivacyActions] Sending shield transaction:', result.transaction);
      
      // Convert BigInt values to hex strings for JSON serialization
      const txForSending = {
        ...result.transaction,
        gasLimit: result.transaction.gasLimit ? '0x' + result.transaction.gasLimit.toString(16) : undefined,
        gasPrice: result.transaction.gasPrice ? '0x' + result.transaction.gasPrice.toString(16) : undefined,
        maxFeePerGas: result.transaction.maxFeePerGas ? '0x' + result.transaction.maxFeePerGas.toString(16) : undefined,
        maxPriorityFeePerGas: result.transaction.maxPriorityFeePerGas ? '0x' + result.transaction.maxPriorityFeePerGas.toString(16) : undefined,
        value: result.transaction.value ? '0x' + result.transaction.value.toString(16) : '0x0',
      };
      
      console.log('[PrivacyActions] Formatted transaction for sending:', txForSending);
      
      // Use signer.sendTransaction instead of provider.request
      const txResponse = await walletSigner.sendTransaction(txForSending);
      
      console.log('[PrivacyActions] Transaction sent:', txResponse);

      toast.dismiss(toastId);
      toast.success(`Successfully shielded ${amount} ${selectedToken.symbol}! TX: ${txResponse}`);

      // Reset form
      setAmount('');
      setSelectedToken(availableTokens[0] || null);

      // ✅ ENHANCED: Graph-based transaction monitoring with new API
      toast.dismiss(toastId);
      toast.success('Shield transaction sent! Monitoring for confirmation...');
      console.log('[PrivacyActions] Starting Graph-based shield monitoring...');
      
      try {
        // Import the enhanced transaction monitor
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor');
        
        // Start monitoring in background with new API specification
        monitorTransactionInGraph({
          txHash: txResponse,
          chainId: chainConfig.id,
          transactionType: 'shield',
          listener: async (event) => {
            console.log(`[PrivacyActions] ✅ Shield tx ${txResponse} indexed on chain ${chainConfig.id}`);
            
            // 🎯 FIXED: Just show success message - let useBalances hook handle refresh when appropriate
            toast.success(`Shield confirmed and indexed! Balance will update automatically.`);
          }
        })
        .then((result) => {
          if (result.found) {
            console.log(`[PrivacyActions] Shield monitoring completed in ${result.elapsedTime/1000}s`);
          } else {
            console.warn('[PrivacyActions] Shield monitoring timed out');
            toast.info('Shield successful! Balance will update automatically.');
          }
        })
        .catch((error) => {
          console.error('[PrivacyActions] Shield Graph monitoring failed:', error);
          // Let balance callback handle the update
        });
        
      } catch (monitorError) {
        console.error('[PrivacyActions] Failed to start shield monitoring:', monitorError);
        // Still rely on balance callback system
      }

    } catch (error) {
      console.error('[PrivacyActions] Shield operation failed:', error);
      toast.dismiss(toastId);
      toast.error(`Shield failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedToken, amount, isValidAmount, railgunAddress, railgunWalletId, chainId, address, getEncryptionKey, availableTokens, refreshBalancesAfterTransaction]);

  // Handle unshield operation
  const handleUnshield = useCallback(async () => {
    if (!selectedToken || !amount || !isValidAmount) {
      return;
    }

    setIsProcessing(true);
    let toastId;

    try {
      toastId = toast.loading('Initializing unshield operation...');

      // Get encryption key
      const encryptionKey = await getEncryptionKey();

      // Parse amount to base units
      const amountInUnits = parseTokenAmount(amount, selectedToken.decimals);

      // Get chain configuration
      const chainConfig = { id: chainId };

      // Use connected address as recipient for unshield
      const toAddress = recipientAddress || address;

      console.log('[PrivacyActions] Starting unshield operation:', {
        token: selectedToken.symbol,
        amount,
        amountInUnits,
        toAddress,
      });

      toast.loading('Generating proof and unshielding tokens...', { id: toastId });

      // Execute unshield operation
      const result = await unshieldTokens({
        railgunWalletID: railgunWalletId,
        encryptionKey,
        tokenAddress: selectedToken.tokenAddress,
        amount: amountInUnits,
        chain: chainConfig,
        toAddress
      });

      toast.dismiss(toastId);
      toast.success(`Successfully unshielded ${amount} ${selectedToken.symbol}!`);

      // Reset form
      setAmount('');
      setRecipientAddress('');
      setSelectedToken(availableTokens[0] || null);

      // ✅ ENHANCED: Graph-based unshield monitoring with new API
      console.log('[PrivacyActions] Starting Graph-based unshield monitoring...');
      
      try {
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor');
        
        // Start monitoring with new API specification
        monitorTransactionInGraph({
          txHash: result.transactionHash,
          chainId: chainConfig.id,
          transactionType: 'unshield',
          listener: async (event) => {
            console.log(`[PrivacyActions] ✅ Unshield tx ${result.transactionHash} indexed on chain ${chainConfig.id}`);
            
            // 🎯 FIXED: Just show success message - let useBalances hook handle refresh when appropriate
            toast.success(`Unshield confirmed and indexed! Balance will update automatically.`);
          }
        })
        .then((monitorResult) => {
          if (monitorResult.found) {
            console.log(`[PrivacyActions] Unshield monitoring completed in ${monitorResult.elapsedTime/1000}s`);
          } else {
            console.warn('[PrivacyActions] Unshield monitoring timed out');
          }
        })
        .catch((error) => {
          console.error('[PrivacyActions] Unshield Graph monitoring failed:', error);
          // Let balance callback handle the update
        });
          
      } catch (error) {
        console.error('[PrivacyActions] Failed to start unshield monitoring:', error);
        // Rely on balance callback system
      }

    } catch (error) {
      console.error('[PrivacyActions] Unshield operation failed:', error);
      toast.dismiss(toastId);
      toast.error(`Unshield failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedToken, amount, isValidAmount, recipientAddress, address, railgunWalletId, chainId, getEncryptionKey, availableTokens, refreshBalancesAfterTransaction]);

  // Handle form submission
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (activeTab === 'shield') {
      handleShield();
    } else if (activeTab === 'unshield') {
      handleUnshield();
    }
  }, [activeTab, handleShield, handleUnshield]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  // Show connection required
  if (!isConnected) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="text-center py-8">
          <EyeSlashIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Connect your wallet to access Railgun privacy features
          </p>
        </div>
      </div>
    );
  }

  // Show unsupported chain
  if (!isChainSupported) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="text-center py-8">
          <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-yellow-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Unsupported Network
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Railgun privacy is not available on this network
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500">
            Supported networks: Ethereum, Arbitrum, Polygon, BNB Smart Chain
          </p>
        </div>
      </div>
    );
  }

  // Show setup incomplete
  if (!railgunSetupComplete) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
            Initializing Railgun
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Setting up privacy system...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <ShieldCheckIcon className="h-6 w-6 text-blue-600" />
          Privacy Actions
        </h2>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8 px-6" aria-label="Tabs">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`${
                  isActive
                    ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2`}
              >
                <Icon className="h-5 w-5" />
                {tab.name}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Token Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Select Token
            </label>
            <select
              value={selectedToken?.address || ''}
              onChange={(e) => {
                const token = availableTokens.find(t => t.address === e.target.value);
                setSelectedToken(token || null);
              }}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              disabled={availableTokens.length === 0}
            >
              {availableTokens.length === 0 ? (
                <option value="">No tokens available</option>
              ) : (
                availableTokens.map((token) => (
                  <option key={token.address || 'native'} value={token.address || ''}>
                    {token.symbol} - {formatBalance(token.numericBalance)} available
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Amount
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                step="any"
                min="0"
                max={selectedToken?.numericBalance || 0}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                disabled={!selectedToken}
              />
              {selectedToken && (
                <button
                  type="button"
                  onClick={() => setAmount(selectedToken.numericBalance.toString())}
                  className="absolute right-2 top-2 px-2 py-1 text-xs bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                >
                  Max
                </button>
              )}
            </div>
            {selectedToken && (
              <p className="mt-1 text-sm text-gray-500">
                Available: {formatBalance(selectedToken.numericBalance)} {selectedToken.symbol}
              </p>
            )}
          </div>

          {/* Recipient Address (for unshield) */}
          {activeTab === 'unshield' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Recipient Address (optional)
              </label>
              <input
                type="text"
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                placeholder={`${address?.slice(0, 6)}...${address?.slice(-4)} (your wallet)`}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-sm text-gray-500">
                Leave empty to unshield to your connected wallet
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isValidAmount || isProcessing || !selectedToken}
            className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
              isValidAmount && !isProcessing && selectedToken
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                Processing...
              </div>
            ) : (
              `${activeTab === 'shield' ? 'Shield' : 'Unshield'} ${selectedToken?.symbol || 'Token'}`
            )}
          </button>
        </form>

        {/* Info */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <div className="flex">
            <ShieldCheckIcon className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="ml-3">
              <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200">
                {tabs.find(t => t.id === activeTab)?.name} Information
              </h4>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                {tabs.find(t => t.id === activeTab)?.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyActions; 