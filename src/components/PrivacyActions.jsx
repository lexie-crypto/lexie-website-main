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
  ArrowRightIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import {
  shieldTokens,
  unshieldTokens,
  isValidRailgunAddress,
  isTokenSupportedByRailgun,
  getSupportedChainIds,
  privateTransfer,
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

const PrivacyActions = ({ activeAction = 'shield' }) => {
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

  // Component state - controlled by parent
  const activeTab = activeAction;
  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [memoText, setMemoText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  // We now rely on WalletContext for initialization status

  // Available tabs
  const tabs = [
    { 
      id: 'shield', 
      name: 'Add', 
      icon: ArrowDownIcon,
      description: 'Move tokens into your vault balance'
    },
    { 
      id: 'unshield', 
      name: 'Remove', 
      icon: ArrowUpIcon,
      description: 'Move tokens back to your connected wallet'
    },
    {
      id: 'transfer',
      name: 'Send',
      icon: ArrowRightIcon,
      description: 'Send to any address (EOA or Lexie ID)'
    },
  ];

  // No local initialization here – WalletContext owns engine lifecycle

  // Get available tokens based on current tab
  const availableTokens = useMemo(() => {
    if (!isConnected || !chainId) return [];

    if (activeTab === 'shield') {
      // Show public tokens for adding to vault
      return publicBalances.filter(token => 
        token.hasBalance && 
        isTokenSupportedByRailgun(token.address, chainId)
      );
    } else if (activeTab === 'unshield' || activeTab === 'transfer') {
      // Show private tokens for removing or sending
      return privateBalances.filter(token => token.hasBalance);
    }

    return [];
  }, [activeTab, publicBalances, privateBalances, isConnected, chainId]);

  // Reset form when switching actions
  useEffect(() => {
    setSelectedToken(null);
    setAmount('');
    setRecipientAddress('');
    setMemoText('');
  }, [activeAction]);

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

  // Detect recipient address type for smart handling
  const recipientType = useMemo(() => {
    if (!recipientAddress) return 'none';
    const addr = recipientAddress.trim();
    
    if (addr.startsWith('0x') && addr.length === 42) return 'eoa';
    if (addr.startsWith('0zk') && addr.length > 50) return 'railgun';
    if (/^[a-zA-Z0-9_]{3,20}$/.test(addr)) return 'lexie';
    return 'invalid';
  }, [recipientAddress]);

  // Show memo field only for railgun/lexie recipients
  const shouldShowMemo = useMemo(() => {
    return activeTab === 'transfer' && (recipientType === 'railgun' || recipientType === 'lexie');
  }, [activeTab, recipientType]);

  // Get encryption key for operations - Use same Redis source as WalletContext
  const getEncryptionKey = useCallback(async () => {
    try {
      if (!address || !railgunWalletId) {
        throw new Error('No wallet address or Railgun wallet ID available');
      }

      // Get signature from Redis (same source as WalletContext)
      console.log('[PrivacyActions] Getting signature from Redis to match WalletContext...');
      
      const response = await fetch(`/api/wallet-metadata?walletAddress=${encodeURIComponent(address)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error('Failed to get wallet metadata from Redis');
      }
      
      const result = await response.json();
      if (!result.success || !result.keys || result.keys.length === 0) {
        throw new Error('No wallet metadata found in Redis');
      }
      
      // Find metadata for current wallet ID
      const metadata = result.keys.find(k => k.walletId === railgunWalletId);
      if (!metadata || !metadata.signature) {
        throw new Error('No signature found in Redis for this wallet');
      }
      
      const signature = metadata.signature;
      console.log('[PrivacyActions] Using signature from Redis (matches WalletContext)');
      

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
        throw new Error('Signature required for vault operations. Please approve the signature request.');
      }
      throw new Error('Failed to get encryption key');
    }
  }, [address, railgunWalletId]);

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

      toast.loading('Adding tokens to vault...', { id: toastId });

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
          // Pass transaction details for note capture with wallet context
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: selectedToken.address,
            decimals: selectedToken.decimals,
            amount: amount,
          },
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
    
    // 🚨 CRITICAL: Validate tokenAddress to prevent USDT decimals miscalculation
    if (!selectedToken.tokenAddress || typeof selectedToken.tokenAddress !== 'string') {
      toast.error('Invalid token selected. Please select a valid token.');
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

      // Smart recipient selection
      const toAddress = activeTab === 'unshield' ? address : (recipientAddress || address);

      console.log('[PrivacyActions] Starting unshield operation:', {
        token: selectedToken.symbol,
        tokenAddress: selectedToken.tokenAddress,
        amount,
        amountInUnits,
        toAddress,
        decimals: selectedToken.decimals,
        chainId: chainId,
        validationStatus: {
          hasTokenAddress: !!selectedToken.tokenAddress,
          tokenAddressLength: selectedToken.tokenAddress?.length || 0,
          tokenAddressValid: selectedToken.tokenAddress?.startsWith('0x') && selectedToken.tokenAddress.length === 42
        }
      });

      toast.loading('Generating proof and unshielding tokens...', { id: toastId });

      // 🔍 CRITICAL: Verify all parameters before unshield call
      const unshieldParams = {
        railgunWalletID: railgunWalletId,
        encryptionKey,
        tokenAddress: selectedToken.tokenAddress,
        amount: amountInUnits,
        chain: chainConfig,
        toAddress,
        walletAddress: address, // 🚨 CRITICAL: Add walletAddress for note retrieval
        decimals: selectedToken.decimals, // 🚨 CRITICAL: Pass decimals from UI to prevent fallback lookups
        walletProvider // ✅ Pass wallet provider for transaction sending
      };
      
      console.log('[PrivacyActions] 🔍 Unshield parameters validation:', {
        hasRailgunWalletID: !!unshieldParams.railgunWalletID,
        hasEncryptionKey: !!unshieldParams.encryptionKey,
        hasTokenAddress: !!unshieldParams.tokenAddress,
        tokenAddressValid: unshieldParams.tokenAddress?.startsWith('0x') && unshieldParams.tokenAddress.length === 42,
        hasAmount: !!unshieldParams.amount,
        hasToAddress: !!unshieldParams.toAddress,
        hasWalletAddress: !!unshieldParams.walletAddress, // For note retrieval
        hasDecimals: unshieldParams.decimals !== undefined && unshieldParams.decimals !== null, // 🚨 CRITICAL
        decimalsValue: unshieldParams.decimals, // Show actual decimals value
        isUSDT: selectedToken.symbol === 'USDT',
        isCorrectUSDTDecimals: selectedToken.symbol === 'USDT' && (unshieldParams.decimals === 6 || (chainId === 56 && unshieldParams.decimals === 18)),
        hasWalletProvider: !!unshieldParams.walletProvider,
        chainId: unshieldParams.chain?.id
      });

      // Execute unshield operation
      const result = await unshieldTokens(unshieldParams);

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
          // Pass transaction details for note processing with wallet context
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: selectedToken.tokenAddress,
            decimals: selectedToken.decimals,
            amount: amount,
            changeCommitment: result.changeCommitment, // For change notes
          },
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

  // Handle private transfer operation
  const handleTransfer = useCallback(async () => {
    if (!selectedToken || !amount || !isValidAmount || !isValidRailgunAddress(railgunAddress)) {
      return;
    }

    // Allow Railgun address (0zk...) OR Lexie ID (3-20 alphanumeric/_)
    if (!isValidRailgunAddress(recipientAddress)) {
      const input = (recipientAddress || '').trim().toLowerCase();
      const isLikelyLexieID = /^[a-z0-9_]{3,20}$/.test(input);
      if (!isLikelyLexieID) {
        toast.error('Please enter a Railgun address (0zk...) or a Lexie ID');
        return;
      }
      // Proceed: resolution will happen in privateTransfer()
    }

    setIsProcessing(true);
    let toastId;

    try {
      toastId = toast.loading('Preparing transaction...');

      const encryptionKey = await getEncryptionKey();
      const amountInUnits = parseTokenAmount(amount, selectedToken.decimals);

      const tx = await privateTransfer({
        chainId,
        railgunWalletID: railgunWalletId,
        encryptionKey,
        tokenAddress: selectedToken.address,
        amount: amountInUnits,
        recipientRailgunAddress: recipientAddress,
        memoText,
        walletProvider,
      });

      toast.dismiss(toastId);
      toast.success(`Transaction sent! TX: ${tx.txHash}`);

      // Reset
      setAmount('');
      setRecipientAddress('');
      setMemoText('');
      setSelectedToken(availableTokens[0] || null);

      // Optional: Graph monitoring (transfer)
      try {
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor');
        monitorTransactionInGraph({
          txHash: tx.txHash,
          chainId,
          transactionType: 'transfer',
          transactionDetails: {
            walletId: railgunWalletId,
            walletAddress: address,
            tokenAddress: selectedToken.address || selectedToken.tokenAddress,
            decimals: selectedToken.decimals,
            amount: amountInUnits,
          },
        }).catch(() => {});
      } catch {}

    } catch (error) {
      console.error('[PrivacyActions] Private transfer failed:', error);
      toast.dismiss(toastId);
      toast.error(`Transfer failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedToken, amount, recipientAddress, memoText, isValidAmount, railgunAddress, railgunWalletId, chainId, walletProvider, getEncryptionKey, availableTokens]);

  // Handle form submission with smart routing
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (activeTab === 'shield') {
      handleShield();
    } else if (activeTab === 'unshield') {
      // Remove tab: always unshield to connected wallet
      handleUnshield();
    } else if (activeTab === 'transfer') {
      // Send tab: smart routing based on recipient type
      if (recipientType === 'eoa') {
        // EOA address: unshield to that address
        handleUnshield();
      } else if (recipientType === 'railgun' || recipientType === 'lexie') {
        // Railgun/Lexie: private transfer
        handleTransfer();
      }
    }
  }, [activeTab, recipientType, handleShield, handleUnshield, handleTransfer]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-green-500/20 rounded mb-4"></div>
          <div className="h-32 bg-green-500/20 rounded"></div>
        </div>
      </div>
    );
  }

  // Show connection required
  if (!isConnected) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="text-center py-8">
          <EyeSlashIcon className="mx-auto h-12 w-12 text-green-400/70 mb-4" />
          <h3 className="text-lg font-medium text-emerald-300 mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-green-400/80">
            Connect your wallet to access vault features
          </p>
        </div>
      </div>
    );
  }

  // Show unsupported chain
  if (!isChainSupported) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="text-center py-8">
          <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-yellow-300 mb-4" />
          <h3 className="text-lg font-medium text-emerald-300 mb-2">
            Unsupported Network
          </h3>
          <p className="text-green-400/80 mb-4">
            Vault is not available on this network
          </p>
          <p className="text-sm text-green-400/60">
            Supported networks: Ethereum, Arbitrum, Polygon, BNB Smart Chain
          </p>
        </div>
      </div>
    );
  }

  // Show setup incomplete - driven by canUseRailgun from context
  if (!canUseRailgun) {
    return (
      <div className="bg-black/40 border border-green-500/20 rounded p-6">
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400 mx-auto mb-4"></div>
          <h3 className="text-lg font-medium text-emerald-300 mb-2">Initializing Vault</h3>
          <p className="text-green-400/80">Setting up vault system...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-black/40 border border-green-500/20 rounded shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-green-500/20">
        <h2 className="text-xl font-semibold text-emerald-300 flex items-center gap-2">
          <ShieldCheckIcon className="h-6 w-6 text-emerald-300" />
          Vault Actions
        </h2>
      </div>

      {/* Current Action Display */}
      <div className="border-b border-green-500/20 px-6 py-3">
        <div className="flex items-center gap-2 text-emerald-300">
          {(() => {
            const currentTab = tabs.find(t => t.id === activeTab);
            const Icon = currentTab?.icon || ShieldCheckIcon;
            return (
              <>
                <Icon className="h-5 w-5" />
                <span className="font-medium">{currentTab?.name || 'Action'}</span>
                <span className="text-green-400/70 text-sm">• {currentTab?.description}</span>
              </>
            );
          })()}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 text-green-300">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Token Selection */}
          <div>
            <label className="block text-sm font-medium text-green-300 mb-2">
              Select Token
            </label>
            <select
              value={selectedToken?.address || ''}
              onChange={(e) => {
                const token = availableTokens.find(t => t.address === e.target.value);
                setSelectedToken(token || null);
              }}
              className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
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
            <label className="block text-sm font-medium text-green-300 mb-2">
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
                className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                disabled={!selectedToken}
              />
              {selectedToken && (
                <button
                  type="button"
                  onClick={() => setAmount(selectedToken.numericBalance.toString())}
                  className="absolute right-2 top-2 px-2 py-1 text-xs bg-black border border-green-500/40 text-green-200 rounded hover:bg-green-900/20"
                >
                  Max
                </button>
              )}
            </div>
            {selectedToken && (
              <p className="mt-1 text-sm text-green-400/70">
                Available: {formatBalance(selectedToken.numericBalance)} {selectedToken.symbol}
              </p>
            )}
          </div>

          {/* Recipient Address - only for send tab */}
          {activeTab === 'transfer' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-green-300 mb-2">
                  Send To
                </label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  placeholder="0x...or Lexie ID"
                  className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                />
                <div className="mt-1 text-xs text-green-400/70">
                  {recipientType === 'eoa' && '📤 Will unshield to public wallet'}
                  {recipientType === 'railgun' && '🔒 Will send privately via Railgun'}
                  {recipientType === 'lexie' && '🔒 Will send privately to Lexie ID'}
                  {recipientType === 'invalid' && recipientAddress && '❌ Invalid address format'}
                  {recipientType === 'none' && 'Enter recipient address or Lexie ID'}
                </div>
              </div>
              
              {/* Memo - only for private transfers */}
              {shouldShowMemo && (
                <div>
                  <label className="block text-sm font-medium text-green-300 mb-2">
                    Memo (optional)
                  </label>
                  <input
                    type="text"
                    value={memoText}
                    onChange={(e) => setMemoText(e.target.value)}
                    placeholder="Thanks for dinner! 🍝😋"
                    className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                  />
                  <p className="mt-1 text-sm text-green-400/70">Memo is encrypted; only sender and recipient can read it.</p>
                </div>
              )}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={!isValidAmount || isProcessing || !selectedToken || (activeTab === 'transfer' && (!recipientAddress || recipientType === 'invalid'))}
            className={`w-full py-3 px-4 rounded font-medium transition-colors ${
              isValidAmount && !isProcessing && selectedToken && (activeTab !== 'transfer' || (recipientAddress && recipientType !== 'invalid'))
                ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-400/40'
                : 'bg-black/40 text-green-400/50 border border-green-500/20 cursor-not-allowed'
            }`}
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-400"></div>
                Processing...
              </div>
            ) : (
              `${activeTab === 'shield' ? 'Add' : activeTab === 'unshield' ? 'Remove' : 'Send'} ${selectedToken?.symbol || 'Token'}`
            )}
          </button>
        </form>

        {/* Info */}
        <div className="mt-6 p-4 bg-black/60 border border-green-500/20 rounded">
          <div className="flex">
            <ShieldCheckIcon className="h-5 w-5 text-emerald-300 flex-shrink-0 mt-0.5" />
            <div className="ml-3">
              <h4 className="text-sm font-medium text-emerald-300">
                {tabs.find(t => t.id === activeTab)?.name} Information
              </h4>
              <p className="mt-1 text-sm text-green-300/80">
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