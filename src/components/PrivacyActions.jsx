/**
 * Privacy Actions Component
 * Provides Shield and Unshield functionality for Railgun privacy wallet
 * Using the new clean Railgun implementation
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { toast } from 'react-hot-toast';
import {
  ShieldCheckIcon,
  EyeSlashIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ArrowRightIcon,
  ClipboardDocumentIcon,
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
import QRCodeGenerator from './QRCodeGenerator';
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
import { getTokenAddress, areTokensEqual } from '../utils/tokens';
import { estimateGasForTransaction } from '../utils/railgun/tx-gas-details';
import { getRailgunNetworkName } from '../utils/railgun/tx-unshield';

const PrivacyActions = ({ activeAction = 'shield', isRefreshingBalances = false }) => {
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
    isPrivateBalancesLoading, // Add
  } = useBalances();

  // isRefreshingBalances is now passed as a prop from WalletPage

  // Component state - controlled by parent
  const activeTab = activeAction;
  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [memoText, setMemoText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isTokenMenuOpen, setIsTokenMenuOpen] = useState(false);
  const [isTransactionLocked, setIsTransactionLocked] = useState(false);
  const [activeTransactionMonitors, setActiveTransactionMonitors] = useState(0);
  const tokenMenuRef = useRef(null);
  // Receive tab state
  const [paymentLink, setPaymentLink] = useState('');
  // Current user's Lexie ID (if linked)
  const [myLexieId, setMyLexieId] = useState(null);

  // Resolve current user's Lexie ID from their Railgun address
  useEffect(() => {
    const resolveMyLexie = async () => {
      try {
        if (!railgunAddress) { setMyLexieId(null); return; }
        const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(railgunAddress)}`);
        if (!resp.ok) { setMyLexieId(null); return; }
        const json = await resp.json().catch(() => ({}));
        if (json.success && json.lexieID) {
          setMyLexieId((json.lexieID || '').toLowerCase());
        } else {
          setMyLexieId(null);
        }
      } catch (_) {
        setMyLexieId(null);
      }
    };
    resolveMyLexie();
  }, [railgunAddress]);
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
    {
      id: 'receive',
      name: 'Receive',
      icon: CurrencyDollarIcon,
      description: 'Use the link below for others to send funds to your vault'
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
    } else if (activeTab === 'receive') {
      // For receive tab, show all supported tokens for this chain (for link generation)
      return [
        { symbol: 'ETH', address: null, name: 'Ethereum' },
        { symbol: 'USDC', address: '0xA0b86a33E6441c0086ec7a4dC2c7c37C1A5e01b4', name: 'USD Coin' },
        { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether USD' },
        // Add more supported tokens as needed
      ].filter(token => isTokenSupportedByRailgun(token.address, chainId));
    }

    return [];
  }, [activeTab, publicBalances, privateBalances, isConnected, chainId]);

  // Reset form when switching actions, but preserve a valid selected token
  useEffect(() => {
    setAmount('');
    setRecipientAddress('');
    setMemoText('');
    setSelectedToken(prev => {
      if (!Array.isArray(availableTokens) || availableTokens.length === 0) return null;

      // Find the token in current availableTokens that matches the previous selection
      const mapped = prev ? availableTokens.find(t => areTokensEqual(t, prev)) : null;
      return mapped || availableTokens[0] || null;
    });
  }, [activeAction, availableTokens]);

  // Complete state reset function for after transactions
  const resetFormState = useCallback(() => {
    console.log('[PrivacyActions] 🔄 Performing complete form state reset...');
    console.log('[PrivacyActions] 🔄 Before reset - isProcessing:', isProcessing, 'selectedToken:', selectedToken?.symbol, 'amount:', amount);

    setAmount('');
    setRecipientAddress('');
    setMemoText('');
    // Keep isProcessing = true until transactionMonitor completes
    // Keep isTransactionLocked = true until transactionMonitor completes

    // Dispatch event to parent components (WalletPage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('privacy-transaction-complete'));
    }

    // Preserve selectedToken by finding the correct token object shape from current availableTokens
    setSelectedToken(prev => {
      if (!Array.isArray(availableTokens) || availableTokens.length === 0) {
        console.log('[PrivacyActions] 🔄 No available tokens, setting selectedToken to null');
        return null;
      }

      // Find the token in current availableTokens that matches the previous selection
      const mapped = prev ? availableTokens.find(t => areTokensEqual(t, prev)) : null;
      const newToken = mapped || availableTokens[0];

      console.log('[PrivacyActions] 🔄 Reset selectedToken - prev:', prev?.symbol, 'mapped:', mapped?.symbol, 'new:', newToken?.symbol);
      console.log('[PrivacyActions] 🔄 Token shapes - prev addr:', getTokenAddress(prev), 'new addr:', getTokenAddress(newToken));

      return newToken;
    });

    console.log('[PrivacyActions] 🔄 Form state reset complete');
  }, [availableTokens, isProcessing, selectedToken, amount]);

  // Ensure transfer-specific fields are cleared when not in transfer mode
  useEffect(() => {
    if (activeTab !== 'transfer') {
      // Clear any stale transfer data that could cause validation issues
      setRecipientAddress('');
      setMemoText('');
    }
  }, [activeTab]);

  // Also handle selection on chain changes without forcing null
  useEffect(() => {
    setAmount('');
    setSelectedToken(prev => {
      if (!Array.isArray(availableTokens) || availableTokens.length === 0) return prev;
      return availableTokens[0];
    });
  }, [chainId, availableTokens]);

  // Close token menu on outside click or ESC
  useEffect(() => {
    if (!isTokenMenuOpen) return;
    const onClickOutside = (e) => {
      if (tokenMenuRef.current && !tokenMenuRef.current.contains(e.target)) {
        setIsTokenMenuOpen(false);
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') setIsTokenMenuOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isTokenMenuOpen]);

  // Listen for balance update completion to unlock transactions
  useEffect(() => {
    const handleBalanceUpdateComplete = (event) => {
      console.log('[PrivacyActions] 🔓 Balance update completed (backup unlock)');
      setIsProcessing(false); // Stop showing "Processing..."
      setIsTransactionLocked(false);
      setActiveTransactionMonitors(0); // Reset counter as backup
    };

    // Listen for transaction monitor completion to unlock transactions
    const handleTransactionMonitorComplete = (event) => {
      const { transactionType, found, elapsedTime } = event.detail;
      console.log(`[PrivacyActions] ✅ Transaction monitor completed for ${transactionType} (${found ? 'found' : 'timeout'}) in ${elapsedTime/1000}s`);

      setActiveTransactionMonitors(prev => {
        const newCount = prev - 1;
        console.log(`[PrivacyActions] 📊 Local monitor count decreased: ${newCount}`);

        // Only unlock UI when ALL monitors have completed
        if (newCount === 0) {
          console.log('[PrivacyActions] 🔓 All local monitors completed, unlocking transaction actions');
          setIsProcessing(false); // Now we can stop showing "Processing..."
          setIsTransactionLocked(false); // And unlock the UI
        } else {
          console.log(`[PrivacyActions] 🔒 Still ${newCount} local monitor(s) running, keeping actions locked`);
        }

        return newCount;
      });

      // 🎯 TRIGGER POINTS UPDATE: When transaction monitor completes successfully,
      // check if points were awarded and update the UI
      if (found && (transactionType === 'shield' || transactionType === 'unshield' || transactionType === 'transfer')) {
        console.log(`[PrivacyActions] 🎯 Transaction monitor completed successfully for ${transactionType}, triggering points update`);
        // Dispatch points update event to refresh points balance from Redis
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('points-updated'));
        }, 500); // Small delay to ensure backend processing is complete
      }
    };

    const handleAbortAllRequests = () => {
      console.log('[PrivacyActions] 🛑 Received abort-all-requests event - cancelling all ongoing processes');
      // Reset all transaction-related state
      setIsProcessing(false);
      setIsTransactionLocked(false);
      setActiveTransactionMonitors(0);
      // Reset form state
      setAmount('');
      setRecipientAddress('');
      setMemoText('');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('railgun-public-refresh', handleBalanceUpdateComplete);
      window.addEventListener('transaction-monitor-complete', handleTransactionMonitorComplete);
      window.addEventListener('abort-all-requests', handleAbortAllRequests);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('railgun-public-refresh', handleBalanceUpdateComplete);
        window.removeEventListener('transaction-monitor-complete', handleTransactionMonitorComplete);
        window.removeEventListener('abort-all-requests', handleAbortAllRequests);
      }
    };
  }, []);

  // Generate payment link when receive tab parameters change (uses active network)
  useEffect(() => {
    if (activeTab === 'receive' && railgunAddress && chainId) {
      const baseUrl = window.location.origin;
      // Prefer Lexie ID if available; fallback to Railgun address
      const toValue = myLexieId || railgunAddress;
      const params = new URLSearchParams({
        to: toValue,
        chainId: chainId.toString(),
      });
      
      if (selectedToken?.address) {
        params.set('token', selectedToken.address);
      }
      
      const link = `${baseUrl}/pay?${params.toString()}`;
      setPaymentLink(link);
    }
  }, [activeTab, railgunAddress, chainId, selectedToken, myLexieId]);

  // Auto-select first available token
  useEffect(() => {
    if (availableTokens.length > 0 && !selectedToken) {
      setSelectedToken(availableTokens[0]);
    }
    if (availableTokens.length === 0 && selectedToken) {
      setSelectedToken(null);
      setAmount('');
    }
  }, [availableTokens, selectedToken]);

  // FORCE BUTTON RESET: Ensure button is always clickable after any state changes
  useEffect(() => {
    // If button would be disabled due to missing selectedToken, force select one
    if (!selectedToken && availableTokens.length > 0) {
      setSelectedToken(availableTokens[0]);
    }

    // If isProcessing is stuck as true (shouldn't happen but safety net)
    if (isProcessing && !selectedToken && availableTokens.length === 0) {
      setIsProcessing(false);
    }
  }, [selectedToken, availableTokens, isProcessing]);



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

  // State to hold gas fee estimation result
  const [gasFeeData, setGasFeeData] = useState(null);
  const [gasEstimationLoading, setGasEstimationLoading] = useState(false);

  // Effect to run gas estimation when dependencies change
  useEffect(() => {
    if (activeTab === 'shield' || !amount || !selectedToken || !isValidAmount || !address || !railgunWalletId || !chainId) {
      setGasFeeData(null);
      setGasEstimationLoading(false);
      return;
    }

    setGasEstimationLoading(true);

    const runGasEstimation = async () => {
      try {
        const numAmount = parseFloat(amount);
        const amountInUnits = parseTokenAmount(amount, selectedToken.decimals);
        const tokenAddr = getTokenAddress(selectedToken);

        if (!tokenAddr) {
          setGasFeeData(null);
          return;
        }

        // Determine transaction type
        const transactionType = activeTab === 'transfer' ? 'transfer' : 'unshield';

        // Get network name (using RAILGUN's proper network name)
        const networkName = getRailgunNetworkName(chainId);
        if (!networkName) {
          setGasFeeData(null);
          return;
        }

        // Get encryption key
        const key = await getEncryptionKey();

        // Run gas estimation using dummy transaction
        const result = await estimateGasForTransaction({
          transactionType,
          chainId,
          networkName,
          railgunWalletID: railgunWalletId,
          encryptionKey: key,
          tokenAddress: tokenAddr,
          amount: amountInUnits,
          recipientAddress: recipientAddress || undefined,
          walletProvider,
        });

        if (result && !result.error) {
          setGasFeeData({
            gasCostUSD: result.gasCostUSD,
            gasCostEth: result.gasCostEth
          });
        } else {
          setGasFeeData(null);
        }
      } catch (error) {
        console.warn('[PrivacyActions] Gas estimation failed:', error.message);
        setGasFeeData(null);
      } finally {
        setGasEstimationLoading(false);
      }
    };

    runGasEstimation();
  }, [amount, selectedToken, isValidAmount, activeTab, address, railgunWalletId, chainId, recipientAddress]);

  // Calculate fees and totals
  const feeInfo = useMemo(() => {
    if (!amount || !selectedToken || !isValidAmount) {
      return null;
    }

    const numAmount = parseFloat(amount);
    const usdValue = selectedToken.balanceUSD ? (
      typeof selectedToken.balanceUSD === 'string' && selectedToken.balanceUSD.startsWith('$')
        ? parseFloat(selectedToken.balanceUSD.substring(1))
        : parseFloat(selectedToken.balanceUSD)
    ) : 0;

    // Calculate USD value of the amount being processed
    const amountUSD = usdValue * (numAmount / selectedToken.numericBalance);

    // Fee rates: 0.25% for shield/add, 0.75% for unshield/remove/send
    const feeRate = activeTab === 'shield' ? 0.0025 : 0.0075; // 0.25% = 0.0025, 0.75% = 0.0075
    const feeUSD = amountUSD * feeRate;

    // Gas fees for unshield and transfer operations
    const gasFeeUSD = gasFeeData ? parseFloat(gasFeeData.gasCostUSD) : 0;

    // Total fees = service fee + gas fee
    const totalFeesUSD = feeUSD + gasFeeUSD;

    // Total received/sent = amount - total fees
    const netAmount = numAmount - (totalFeesUSD / usdValue * numAmount);
    const netAmountUSD = amountUSD - totalFeesUSD;

    return {
      amountUSD: amountUSD.toFixed(2),
      feeUSD: feeUSD.toFixed(2),
      gasFeeUSD: gasFeeData ? gasFeeData.gasCostUSD : null,
      feePercent: (feeRate * 100).toFixed(2),
      netAmount: netAmount.toFixed(6),
      netAmountUSD: netAmountUSD.toFixed(2)
    };
  }, [amount, selectedToken, isValidAmount, activeTab, gasFeeData]);

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
    setIsTransactionLocked(true); // Lock all transaction actions

    // Dispatch event to parent components (WalletPage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('privacy-transaction-start'));
    }

    // Increment local monitor counter
    setActiveTransactionMonitors(prev => prev + 1);

    let toastId;

    try {

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

      toastId = toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Adding tokens to vault...</div>
                <div className="text-xs text-green-400/80">Approve in your wallet</div>
              </div>
              <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ), { duration: 3000 });

      // Get wallet signer (not provider to avoid re-wrapping)
      const walletSigner = await walletProvider(); // This now returns a signer

      // Get normalized token address
      const tokenAddr = getTokenAddress(selectedToken);
      // Allow null addresses for native tokens (e.g., ETH)
      const isNativeToken = !tokenAddr && selectedToken.symbol === 'ETH';
      if (!tokenAddr && !isNativeToken) {
        console.error('[PrivacyActions] Shield failed: Invalid token address', selectedToken);
        toast.error('Selected token is invalid. Please reselect the token.');
        return;
      }

      // Execute shield operation
      const result = await shieldTokens({
        tokenAddress: tokenAddr,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: railgunAddress,
        walletProvider: walletSigner // Pass signer directly
      });

      // Send the transaction to the blockchain
      toast.dismiss(toastId);
      toastId = toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Adding {amount} {selectedToken.symbol} to your vault...</div>
              </div>
              <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ), { duration: 2500 });
      
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
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Added {amount} {selectedToken.symbol} to your vault</div>
                <div className="text-xs text-green-400/80">TX sent</div>
              </div>
              <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ), { duration: 3000 });

      // ✅ ENHANCED: Graph-based transaction monitoring with new API
      toast.dismiss(toastId);
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Adding {amount} {selectedToken.symbol} to your vault...</div>
                <div className="text-xs text-green-400/80">Monitoring for confirmation...</div>
              </div>
            </div>
          </div>
        </div>
      ), { duration: 2500 });
      console.log('[PrivacyActions] Starting Graph-based shield monitoring...');
      
      try {
        // Import the enhanced transaction monitor
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor.js');
        
        // Start monitoring in background with new API specification
        monitorTransactionInGraph({
          txHash: txResponse?.hash || txResponse,
          chainId: chainConfig.id,
          transactionType: 'shield',
          // Pass transaction details for note capture with wallet context
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            railgunAddress: railgunAddress,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: tokenAddr,
            decimals: selectedToken.decimals,
            amount: amount,
          },
          listener: async (event) => {
            console.log(`[PrivacyActions] ✅ Shield tx ${txResponse?.hash || txResponse} indexed on chain ${chainConfig.id}`);
            
            // 🎯 FIXED: Just show success message - let useBalances hook handle refresh when appropriate
            toast.custom((t) => (
              <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div>
                      <div className="text-sm">Added {amount} {selectedToken.symbol} to your vault</div>
                      <div className="text-xs text-green-400/80">Balance will update automatically</div>
                    </div>
                    <button 
                      type="button" 
                      aria-label="Dismiss" 
                      onClick={(e) => { 
                        e.preventDefault(); 
                        e.stopPropagation(); 
                        console.log('Dismissing toast:', t.id);
                        toast.dismiss(t.id);
                      }} 
                      className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ), { duration: 3000 });
          }
        })
        .then(async (result) => {
          if (result.found) {
            console.log(`[PrivacyActions] Shield monitoring completed in ${result.elapsedTime/1000}s`);

            // 🎯 FALLBACK: Directly award points if transaction monitor didn't
            try {
              console.log('[PrivacyActions] 🎯 Checking if points need to be awarded...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for points award');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for points award');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for points award:', lexieId);

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: txResponse?.hash || txResponse,
                  usdValue: Number(amount) // Assume amount is in USD for simplicity
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded via fallback (10x multiplier):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier,
                    pointsMultiplier: pointsData.pointsMultiplier,
                    basePointsBefore: pointsData.basePointsBeforeMultiplier,
                    basePointsAfter: pointsData.basePointsAfterMultiplier,
                    dayCount: pointsData.dayCount
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Points award failed:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Points fallback failed:', pointsError);
            }

          } else {
            console.warn('[PrivacyActions] Shield monitoring timed out');
            toast.info('Shield successful! Balance will update automatically.');
          }
          // Dispatch transaction monitor completion event
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'shield', found: result.found, elapsedTime: result.elapsedTime }
            }));
          }
        })
        .catch((error) => {
          console.error('[PrivacyActions] Shield Graph monitoring failed:', error);
          // Dispatch transaction monitor completion event even on failure
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'shield', found: false, error: error.message }
            }));
          }
        });
        
      } catch (monitorError) {
        console.error('[PrivacyActions] Failed to start shield monitoring:', monitorError);
        // Dispatch transaction monitor completion event even if failed to start
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
            detail: { transactionType: 'shield', found: false, error: monitorError.message }
          }));
        }
      }

    } catch (error) {
      console.error('[PrivacyActions] Shield operation failed:', error);
      toast.dismiss(toastId);

      // Dispatch transaction completion event to unlock UI globally
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
          detail: {
            transactionType: 'shield',
            found: false, // Transaction failed/cancelled
            elapsedTime: 0,
            error: error.message
          }
        }));
      }

      if ((error?.message || '').toLowerCase().includes('rejected') || error?.code === 4001) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Rejected by User</div>
                </div>
              </div>
            </div>
          </div>
        ), { duration: 3000 });
      } else {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Failed to add {amount} {selectedToken?.symbol || 'token'} to your vault</div>
                  <div className="text-xs text-green-400/80">{error.message || 'Please try again'}</div>
                </div>
              </div>
            </div>
          </div>
        ), { duration: 4000 });
      }
    } finally {
      resetFormState();
    }
  }, [selectedToken, amount, isValidAmount, railgunAddress, railgunWalletId, chainId, address, getEncryptionKey, availableTokens, refreshBalancesAfterTransaction, resetFormState]);

  // Handle unshield operation
  const handleUnshield = useCallback(async () => {
    if (!selectedToken || !amount || !isValidAmount) {
      return;
    }

    // 🚨 CRITICAL: Validate tokenAddress to prevent USDT decimals miscalculation
    const tokenAddr = getTokenAddress(selectedToken);
    if (!tokenAddr) {
      console.error('[PrivacyActions] Unshield failed: Invalid token address', selectedToken);
      toast.error('Selected token is invalid. Please reselect the token.');
      return;
    }

    setIsProcessing(true);
    setIsTransactionLocked(true); // Lock all transaction actions

    // Dispatch event to parent components (WalletPage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('privacy-transaction-start'));
    }

    // Increment local monitor counter
    setActiveTransactionMonitors(prev => prev + 1);

    let toastId;

    try {

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
        tokenAddress: tokenAddr,
        amount,
        amountInUnits,
        toAddress,
        decimals: selectedToken.decimals,
        chainId: chainId,
        validationStatus: {
          hasTokenAddress: !!tokenAddr,
          tokenAddressLength: tokenAddr?.length || 0,
          tokenAddressValid: tokenAddr?.startsWith('0x') && tokenAddr.length === 42
        }
      });

      // 🔍 CRITICAL: Verify all parameters before unshield call
      const unshieldParams = {
        railgunWalletID: railgunWalletId,
        encryptionKey,
        tokenAddress: tokenAddr,
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
      // Immediately perform an optimistic local update so dropdown reflects depletion
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('railgun-optimistic-unshield', {
            detail: {
              tokenSymbol: selectedToken.symbol,
              tokenAddress: tokenAddr,
              amount: Number(amount),
            }
          }));
        }
      } catch {}


      toast.dismiss(toastId);

      // ✅ ENHANCED: Graph-based unshield monitoring with new API
      console.log('[PrivacyActions] Starting Graph-based unshield monitoring...');
      
      try {
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor.js');
        
        // Start monitoring with new API specification
        monitorTransactionInGraph({
          txHash: result.transactionHash,
          chainId: chainConfig.id,
          transactionType: 'unshield',
          // Pass transaction details for note processing with wallet context
          transactionDetails: {
            walletAddress: address,
            walletId: railgunWalletId,
            railgunAddress: railgunAddress,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: tokenAddr,
            decimals: selectedToken.decimals,
            amount: amount,
            recipientAddress: toAddress, // Add recipient address for unshield
            senderAddress: address, // Add sender address for unshield
            changeCommitment: result.changeCommitment, // For change notes
          },
          listener: async (event) => {
            console.log(`[PrivacyActions] ✅ Unshield tx ${result.transactionHash} indexed on chain ${chainConfig.id}`);
            
            // 🎯 FIXED: Just show success message - let useBalances hook handle refresh when appropriate

          }
        })
        .then(async (monitorResult) => {
          if (monitorResult.found) {
            console.log(`[PrivacyActions] Unshield monitoring completed in ${monitorResult.elapsedTime/1000}s`);

            // 🎯 FALLBACK: Directly award points for unshield if transaction monitor didn't
            try {
              console.log('[PrivacyActions] 🎯 Checking if points need to be awarded for unshield...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for unshield points award');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for unshield points award');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for unshield points award:', lexieId);

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: result.transactionHash,
                  usdValue: Number(amount) // Assume amount is in USD for simplicity
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded for unshield via fallback (10x multiplier):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier,
                    pointsMultiplier: pointsData.pointsMultiplier,
                    basePointsBefore: pointsData.basePointsBeforeMultiplier,
                    basePointsAfter: pointsData.basePointsAfterMultiplier,
                    dayCount: pointsData.dayCount
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Unshield points award failed:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Unshield points fallback failed:', pointsError);
            }

          } else {
            console.warn('[PrivacyActions] Unshield monitoring timed out');
          }
          // Dispatch transaction monitor completion event
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'unshield', found: monitorResult.found, elapsedTime: monitorResult.elapsedTime }
            }));
          }
        })
        .catch((error) => {
          console.error('[PrivacyActions] Unshield Graph monitoring failed:', error);
          // Dispatch transaction monitor completion event even on failure
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'unshield', found: false, error: error.message }
            }));
          }
        });
          
      } catch (error) {
        console.error('[PrivacyActions] Failed to start unshield monitoring:', error);
        // Dispatch transaction monitor completion event even if failed to start
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
            detail: { transactionType: 'unshield', found: false, error: error.message }
          }));
        }
      }

    } catch (error) {
      console.error('[PrivacyActions] Unshield operation failed:', error);
      toast.dismiss(toastId);

      // Dispatch transaction completion event to unlock UI globally
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
          detail: {
            transactionType: 'unshield',
            found: false, // Transaction failed/cancelled
            elapsedTime: 0,
            error: error.message
          }
        }));
      }
    } finally {
      resetFormState();
    }
  }, [selectedToken, amount, isValidAmount, recipientAddress, address, railgunWalletId, chainId, getEncryptionKey, availableTokens, refreshBalancesAfterTransaction, resetFormState]);

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
        toast.error('Please enter a valid EVM address or a Lexie ID');
        return;
      }
      // Fast pre-check: Verify Lexie ID exists before starting heavy processing
      try {
        const resp = await fetch(`/api/wallet-metadata?action=lexie-resolve&lexieID=${encodeURIComponent(input)}`);
        if (!resp.ok) {
          // 404 or any non-200: treat as not linked
          toast.custom((t) => (
            <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
              <div className="rounded-lg border border-red-500/30 bg-black/90 text-green-200 shadow-2xl">
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <div>
                    <div className="text-sm">Lexie ID does not exist or is not linked to a LexieVault</div>
                  </div>
                </div>
              </div>
            </div>
          ), { duration: 3500 });
          return;
        }
        const data = await resp.json().catch(() => ({}));
        if (!data?.success || !data?.walletAddress) {
          toast.custom((t) => (
            <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
              <div className="rounded-lg border border-red-500/30 bg-black/90 text-green-200 shadow-2xl">
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-red-400" />
                  <div>
                    <div className="text-sm">Lexie ID does not exist or is not linked to a LexieVault</div>
                  </div>
                </div>
              </div>
            </div>
          ), { duration: 3500 });
          return;
        }
      } catch (_) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Lexie ID does not exist or is not linked to a LexieVault</div>
                </div>
              </div>
            </div>
          </div>
        ), { duration: 3500 });
        return;
      }
      // Proceed: resolution will happen in privateTransfer()
    }

    setIsProcessing(true);
    setIsTransactionLocked(true); // Lock all transaction actions

    // Dispatch event to parent components (WalletPage)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('privacy-transaction-start'));
    }

    // Increment local monitor counter
    setActiveTransactionMonitors(prev => prev + 1);

    let toastId;

    try {
      toastId = toast.custom((t) => (
        <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Preparing transaction…</div>
                <div className="text-xs text-green-400/80">Encrypting and preparing proofs</div>
              </div>
              <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ));

      const encryptionKey = await getEncryptionKey();
      const amountInUnits = parseTokenAmount(amount, selectedToken.decimals);
      const tokenAddr = getTokenAddress(selectedToken);

      if (!tokenAddr) {
        console.error('[PrivacyActions] Transfer failed: Invalid token address', selectedToken);
        toast.error('Selected token is invalid. Please reselect the token.');
        return;
      }

      const tx = await privateTransfer({
        chainId,
        railgunWalletID: railgunWalletId,
        encryptionKey,
        tokenAddress: tokenAddr,
        amount: amountInUnits,
        recipientRailgunAddress: recipientAddress,
        memoText,
        walletProvider,
      });

      // Use resolved recipient address for timeline (Railgun address instead of Lexie ID)
      const timelineRecipientAddress = tx.resolvedRecipientAddress || recipientAddress;

      toast.dismiss(toastId);
      toast.custom((t) => (
        <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Transaction sent</div>
                <div className="text-xs text-green-400/80">TX: {tx.txHash}</div>
              </div>
              <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      ), { duration: 3000 });

      // Trigger transaction history refresh to show the new transaction with memo
      setTimeout(() => {
        console.log('🔄 [PrivacyActions] Triggering transaction history refresh after transfer');
        window.dispatchEvent(new CustomEvent('transaction-history-refresh'));
      }, 3000); // Wait 3 seconds for transaction to be mined and indexed

      // Optional: Graph monitoring (transfer)
      try {
        const { monitorTransactionInGraph } = await import('../utils/railgun/transactionMonitor.js');
        monitorTransactionInGraph({
          txHash: tx.txHash,
          chainId,
          transactionType: 'transfer',
          transactionDetails: {
            walletId: railgunWalletId,
            walletAddress: address,
            railgunAddress: railgunAddress,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: tokenAddr,
            decimals: selectedToken.decimals,
            amount: amountInUnits,
            recipientAddress: timelineRecipientAddress, // Use resolved Railgun address
            memoText: memoText, // Add memo text
          },
        })
        .then(async (result) => {
          if (result.found) {
            console.log(`[PrivacyActions] Transfer monitoring completed in ${result.elapsedTime/1000}s`);

            // 🎯 FALLBACK: Directly award points for transfer if transaction monitor didn't
            try {
              console.log('[PrivacyActions] 🎯 Checking if points need to be awarded for transfer...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for transfer points award');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for transfer points award');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for transfer points award:', lexieId);

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: tx.txHash,
                  usdValue: Number(amount) // Assume amount is in USD for simplicity
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded for transfer via fallback (10x multiplier):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier,
                    pointsMultiplier: pointsData.pointsMultiplier,
                    basePointsBefore: pointsData.basePointsBeforeMultiplier,
                    basePointsAfter: pointsData.basePointsAfterMultiplier,
                    dayCount: pointsData.dayCount
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Transfer points award failed:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Transfer points fallback failed:', pointsError);
            }
          }

          // Dispatch transaction monitor completion event
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'transfer', found: result.found, elapsedTime: result.elapsedTime }
            }));
          }
        })
        .catch((error) => {
          console.error('[PrivacyActions] Transfer Graph monitoring failed:', error);
          // Dispatch transaction monitor completion event even on failure
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
              detail: { transactionType: 'transfer', found: false, error: error.message }
            }));
          }
        });
      } catch (error) {
        console.error('[PrivacyActions] Failed to start transfer monitoring:', error);
        // Dispatch transaction monitor completion event even if failed to start
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
            detail: { transactionType: 'transfer', found: false, error: error.message }
          }));
        }
      }

    } catch (error) {
      console.error('[PrivacyActions] Private transfer failed:', error);
      toast.dismiss(toastId);

      // Dispatch transaction completion event to unlock UI globally
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
          detail: {
            transactionType: 'transfer',
            found: false, // Transaction failed/cancelled
            elapsedTime: 0,
            error: error.message
          }
        }));
      }

      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('rejected') || error?.code === 4001) {
        toast.custom((t) => (
          <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Rejected by User</div>
                </div>
                <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
              </div>
            </div>
          </div>
        ), { duration: 3000 });
      } else {
        toast.custom((t) => (
          <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Failed to send transaction</div>
                  <div className="text-xs text-green-400/80">{error.message}</div>
                </div>
                <button 
                type="button" 
                aria-label="Dismiss" 
                onClick={(e) => { 
                  e.preventDefault(); 
                  e.stopPropagation(); 
                  console.log('Dismissing toast:', t.id);
                  toast.dismiss(t.id);
                }} 
                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
              >
                ×
              </button>
              </div>
            </div>
          </div>
        ), { duration: 4000 });
      }
    } finally {
      resetFormState();
    }
  }, [selectedToken, amount, recipientAddress, memoText, isValidAmount, railgunAddress, railgunWalletId, chainId, walletProvider, getEncryptionKey, availableTokens, resetFormState]);

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
        <div className="flex items-center gap-2 text-emerald-300 flex-wrap">
          {(() => {
            const currentTab = tabs.find(t => t.id === activeTab);
            const Icon = currentTab?.icon || ShieldCheckIcon;
            return (
              <>
                <Icon className="h-5 w-5" />
                <span className="font-medium">{currentTab?.name || 'Action'}</span>
                <span className="text-green-400/70 text-sm break-words">• {currentTab?.description}</span>
              </>
            );
          })()}
        </div>
      </div>

      {/* Vault Balances - hide on Receive tab */}
      {activeTab !== 'receive' && (
        <div className="px-6 py-4 border-b border-green-500/20">
          <div className="flex items-center justify-between">
            <h3 className="text-emerald-300 font-semibold">{getCurrentNetwork()?.name || 'Network'} Vault Balances</h3>
          </div>
          <div className="mt-3 text-green-300/80">
            {isPrivateBalancesLoading ? (
              <div className="mb-3 flex items-center gap-2 text-sm text-green-300">
                <div className="h-4 w-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
                Getting your vault balances...
              </div>
            ) : privateBalances && privateBalances.length > 0 ? (
              <div className="space-y-2">
                <div className="text-sm text-green-400/70">{privateBalances.length} Vault Token{privateBalances.length !== 1 ? 's' : ''}</div>
                {privateBalances.map((token) => (
                  <div key={getTokenAddress(token) || token.symbol} className="p-2 bg-black/60 rounded text-sm border border-green-500/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-green-200 font-medium">{token.symbol}</span>
                        <span className="text-green-400/70 truncate">• {token.name || `${token.symbol} Token`}</span>
                      </div>
                      <div className="text-green-200">{Number(token.numericBalance).toFixed(6).replace(/\.?0+$/, '')}</div>
                    </div>
                    {token.balanceUSD !== undefined && (
                      <div className="text-right text-green-400/70 mt-1">${typeof token.balanceUSD === 'string' && token.balanceUSD.startsWith('$') ? token.balanceUSD.substring(1) : token.balanceUSD}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-green-400/70">No vault tokens yet<br />Add some tokens to start using secure vault</div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-6 text-green-300">
        {activeTab === 'receive' ? (
          // Receive tab content - Payment link generator
          <div className="space-y-6">
            {/* Network selection removed – link uses active network automatically */}

            {/* QR Code */}
            {paymentLink && (
              <div className="space-y-4">
                <label className="block text-sm font-medium text-green-300">
                  QR Code
                </label>
                <div className="flex justify-center">
                  <QRCodeGenerator value={paymentLink} size={200} />
                </div>
                <p className="text-center text-sm text-green-400/70">
                  Share this QR code for others to scan and fund your vault
                </p>
              </div>
            )}

            {/* Payment Link */}
            {paymentLink && (
              <div className="space-y-4">
                <label className="block text-sm font-medium text-green-300">
                  Payment Link
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <input
                    type="text"
                    value={paymentLink}
                    readOnly
                    className="flex-1 w-full min-w-0 px-3 py-2 border border-green-500/40 rounded bg-black text-green-200 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(paymentLink);
                      toast.custom((t) => (
                        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                            <div className="px-4 py-3 flex items-center gap-3">
                              <div className="h-3 w-3 rounded-full bg-emerald-400" />
                              <div>
                                <div className="text-sm">link &gt;&gt; copied</div>
                              </div>
                              <button 
                                type="button" 
                                aria-label="Dismiss" 
                                onClick={(e) => { 
                                  e.preventDefault(); 
                                  e.stopPropagation(); 
                                  toast.dismiss(t.id);
                                }} 
                                className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80 cursor-pointer"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        </div>
                      ), { duration: 2000 });
                    }}
                    className="w-full sm:w-auto px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 rounded border border-emerald-400/40 flex items-center justify-center gap-1"
                  >
                    <ClipboardDocumentIcon className="h-4 w-4" />
                    Copy
                  </button>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="bg-black/60 border border-green-500/20 rounded p-4">
              <h4 className="text-sm font-medium text-emerald-300 mb-2">How it works</h4>
              <ul className="text-sm text-green-300/80 space-y-1">
                <li>• Share the payment link or QR code with others</li>
                <li>• They can click the link to fund your vault directly</li>
                <li>• Funds are deposited into your vault automatically</li>
              </ul>
            </div>
          </div>
        ) : (
          // Original form content for other tabs
          <form onSubmit={handleSubmit} className="space-y-6">
          {/* Token Selection */}
          <div>
            <label className="block text-sm font-medium text-green-300 mb-2">
              Select Token
            </label>
            <div className="relative" ref={tokenMenuRef}>
              <button
                type="button"
                onClick={() => { if (availableTokens.length > 0) setIsTokenMenuOpen((v) => !v); }}
                disabled={availableTokens.length === 0}
                className={`w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200 flex items-center justify-between ${
                  availableTokens.length === 0 ? 'cursor-not-allowed opacity-60' : 'hover:bg-green-900/20'
                }`}
              >
                <span>
                  {selectedToken
                    ? `${selectedToken.symbol} - ${formatBalance(selectedToken.numericBalance)} available${selectedToken.balanceUSD !== undefined ? ` ($${typeof selectedToken.balanceUSD === 'string' && selectedToken.balanceUSD.startsWith('$') ? selectedToken.balanceUSD.substring(1) : selectedToken.balanceUSD})` : ''}`
                    : availableTokens.length === 0
                      ? 'No tokens available'
                      : 'Select token'}
                </span>
                <span className="ml-2">▾</span>
              </button>
              {isTokenMenuOpen && (
                <div className="absolute z-20 mt-1 left-0 right-0 bg-black text-green-300 border border-green-500/40 rounded shadow-xl max-h-60 overflow-auto">
                  {availableTokens.map((token) => (
                    <button
                      key={getTokenAddress(token) || token.symbol}
                      type="button"
                      onClick={() => { setSelectedToken(token); setIsTokenMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-emerald-900/30 focus:bg-emerald-900/30 focus:outline-none"
                    >
                      {token.symbol} - {formatBalance(token.numericBalance)} available
                      {token.balanceUSD !== undefined && (
                        <span className="text-green-400/70">
                          {' '}(${typeof token.balanceUSD === 'string' && token.balanceUSD.startsWith('$') ? token.balanceUSD.substring(1) : token.balanceUSD})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
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

            {/* Fee Display */}
            {feeInfo && (
              <div className="mt-3 p-3 bg-black/40 border border-green-500/20 rounded text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-400/80">Network Fees:</span>
                    <span className="text-green-200">${feeInfo.feeUSD} ({feeInfo.feePercent}%)</span>
                  </div>
                  {(gasEstimationLoading || gasFeeData) && activeTab !== 'shield' && (
                    <div className="flex justify-between border-b border-green-500/20 pb-1 mb-1">
                      <span className="text-green-400/80">Est. Gas Fees:</span>
                      <span className="text-green-200 flex items-center gap-2">
                        {gasEstimationLoading ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b border-green-400"></div>
                            Calculating...
                          </>
                        ) : (
                          `$${gasFeeData.gasCostUSD}`
                        )}
                      </span>
                    </div>
                  )}
                  {(gasEstimationLoading || gasFeeData) && activeTab !== 'shield' && (
                    <div className="flex justify-between">
                      <span className="text-green-400/80">Est. Total Fees:</span>
                      <span className="text-green-200 flex items-center gap-2">
                        {gasEstimationLoading ? (
                          <>
                            <div className="animate-spin rounded-full h-3 w-3 border-b border-green-400"></div>
                            Calculating...
                          </>
                        ) : (
                          `$${(parseFloat(feeInfo.feeUSD) + parseFloat(gasFeeData.gasCostUSD)).toFixed(2)}`
                        )}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium">
                    <span className="text-green-300">
                      {(gasEstimationLoading || gasFeeData) && activeTab !== 'shield' ? 'Est. ' : ''}Total {activeTab === 'shield' ? 'Added' : activeTab === 'unshield' ? 'Received' : 'Sent'}:
                    </span>
                    <span className="text-emerald-300">
                      {feeInfo.netAmount} {selectedToken.symbol} (${feeInfo.netAmountUSD})
                    </span>
                  </div>
                </div>
              </div>
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
                  {recipientType === 'eoa' && 'Will send to public address'}
                  {recipientType === 'railgun' && 'Will send to zk-shielded address (0zk...)'}
                  {recipientType === 'lexie' && 'Will send to Lexie ID'}
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
            disabled={!isValidAmount || isProcessing || isTransactionLocked || !selectedToken || (activeTab === 'transfer' && (!recipientAddress || recipientType === 'invalid'))}
            className={`w-full py-3 px-4 rounded font-medium transition-colors ${
              isValidAmount && !isProcessing && !isTransactionLocked && selectedToken && (activeTab !== 'transfer' || (recipientAddress && recipientType !== 'invalid'))
                ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-400/40'
                : 'bg-black/40 text-green-400/50 border border-green-500/20 cursor-not-allowed'
            }`}
          >
            {isProcessing ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-400"></div>
                Processing...
              </div>
            ) : isTransactionLocked ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
                Updating Balances...
              </div>
            ) : (
              `${activeTab === 'shield' ? 'Add' : activeTab === 'unshield' ? 'Remove' : 'Send'} ${selectedToken?.symbol || 'Token'}`
            )}
          </button>
        </form>
        )}

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