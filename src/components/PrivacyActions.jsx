/**
 * Privacy Actions Component
 * Provides Shield and Unshield functionality for Railgun privacy wallet
 * Using the new clean Railgun implementation
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ethers } from 'ethers';
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
  UsersIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import useBalances from '../hooks/useBalances';
import { useContacts } from '../hooks/useContacts';
import ContactModal from './ContactModal';
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
  roundBalanceTo8Decimals,
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

  const {
    contacts,
    searchContacts,
    findContactByAddress,
    addContact,
    updateContact,
    removeContact,
    clearContacts,
    isLoading: isLoadingContacts,
  } = useContacts();

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
  // Contacts state
  const [showAddContactModal, setShowAddContactModal] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactSuggestions, setContactSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showContactSelectionModal, setShowContactSelectionModal] = useState(false);

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
      description: 'Send to any address (EOA or LexieID)'
    },
    {
      id: 'receive',
      name: 'Receive',
      icon: CurrencyDollarIcon,
      description: 'Use the link below for others to send funds to your vault'
    },
    {
      id: 'contacts',
      name: 'Contacts',
      icon: UsersIcon,
      description: 'Manage your saved contacts for easy sending'
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

  // Track previous activeAction to only clear form on actual action changes
  const prevActiveActionRef = useRef(activeAction);

  // Reset form when switching actions, but preserve a valid selected token
  useEffect(() => {
    const actionChanged = prevActiveActionRef.current !== activeAction;

    // Only clear form fields when action actually changes, not on balance refreshes
    if (actionChanged) {
      setAmount('');
      setRecipientAddress('');
      setMemoText('');
    }

    setSelectedToken(prev => {
      if (!Array.isArray(availableTokens) || availableTokens.length === 0) return null;

      // Find the token in current availableTokens that matches the previous selection
      const mapped = prev ? availableTokens.find(t => areTokensEqual(t, prev)) : null;
      return mapped || availableTokens[0] || null;
    });

    // Update the ref after processing
    prevActiveActionRef.current = activeAction;
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

  // Track previous chainId to only clear amount on actual chain changes
  const prevChainIdRef = useRef(chainId);

  // Handle token selection on chain changes or available tokens changes
  useEffect(() => {
    const chainChanged = prevChainIdRef.current !== chainId;

    // Only clear amount when chain actually changes, not on balance refreshes
    if (chainChanged) {
      setAmount('');
    }

    setSelectedToken(prev => {
      if (!Array.isArray(availableTokens) || availableTokens.length === 0) return null;

      // Preserve the user's selected token if it's still available
      if (prev) {
        const stillAvailable = availableTokens.find(t => areTokensEqual(t, prev));
        if (stillAvailable) return stillAvailable;
      }

      // Otherwise select the first available token
      return availableTokens[0];
    });

    // Update the ref after processing
    prevChainIdRef.current = chainId;
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

  // Handle shield transaction dropped events
  const handleShieldTransactionDropped = useCallback((event) => {
    console.log('[PrivacyActions] 🚫 Shield transaction dropped - unlocking UI:', event.detail);
    setIsProcessing(false);
    setIsTransactionLocked(false);
    // Decrement monitor counter
    setActiveTransactionMonitors(prev => Math.max(0, prev - 1));
  }, []);

  // Listen for balance update completion to unlock transactions
  useEffect(() => {
    const handleBalanceUpdateComplete = (event) => {
      // Only unlock on balance updates if no transaction monitors are active
      // This prevents premature unlocking during vault building/commitment decryption
      if (activeTransactionMonitors === 0) {
        console.log('[PrivacyActions] 🔓 Balance update completed (backup unlock) - no active monitors');
        setIsProcessing(false); // Stop showing "Processing..."
        setIsTransactionLocked(false);
        setActiveTransactionMonitors(0); // Reset counter as backup
      } else {
        console.log('[PrivacyActions] 🔒 Balance update received but transaction monitors still active - keeping UI locked');
      }
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
      window.addEventListener('shield-transaction-dropped', handleShieldTransactionDropped);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('railgun-public-refresh', handleBalanceUpdateComplete);
        window.removeEventListener('transaction-monitor-complete', handleTransactionMonitorComplete);
        window.removeEventListener('abort-all-requests', handleAbortAllRequests);
        window.removeEventListener('shield-transaction-dropped', handleShieldTransactionDropped);
      }
    };
  }, [handleShieldTransactionDropped]);

  // Generate payment link when receive tab parameters change (uses active network)
  useEffect(() => {
    if (activeTab === 'receive' && railgunAddress && chainId) {
      const baseUrl = 'https://pay.lexiecrypto.com';
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

  // Basic amount validation (allow any positive amount)
  const isValidAmount = useMemo(() => {
    if (!amount || !selectedToken) return false;

    const numAmount = parseFloat(amount);
    return !isNaN(numAmount) && numAmount > 0;
  }, [amount, selectedToken]);

  // Validation check: amount cannot exceed available balance (with 8-decimal rounding)
  const exceedsAvailableBalance = useMemo(() => {
    if (!amount || !selectedToken) return false;

    try {
      // Parse user amount to wei with rounding
      const userAmountInWei = parseTokenAmount(amount, selectedToken.decimals);

      // Round available balance to 8 decimal places
      const roundedBalanceInWei = roundBalanceTo8Decimals(selectedToken.balance || '0', selectedToken.decimals);

      // Compare wei amounts
      return BigInt(userAmountInWei) > BigInt(roundedBalanceInWei);
    } catch (error) {
      console.warn('[Balance Validation] Error in exceedsAvailableBalance check:', error);
      // Fallback to original logic if rounding fails
      const numAmount = parseFloat(amount);
      return numAmount > (selectedToken.numericBalance || 0);
    }
  }, [amount, selectedToken]);

  // State to hold gas fee estimation result
  const [gasFeeData, setGasFeeData] = useState(null);

  // Effect to run gas estimation when dependencies change
  useEffect(() => {
    if (activeTab === 'shield' || !amount || !selectedToken || !isValidAmount || !address || !railgunWalletId || !chainId) {
      setGasFeeData(null);
      return;
    }

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
            gasCostNative: result.gasCostNative,
            nativeGasToken: result.nativeGasToken
          });
        } else {
          setGasFeeData(null);
        }
      } catch (error) {
        console.warn('[PrivacyActions] Gas estimation failed:', error.message);
        setGasFeeData(null);
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

    // Guard against invalid USD values
    const hasValidUSD = usdValue > 0 && !isNaN(usdValue) && isFinite(usdValue);

    // Calculate USD value of the amount being processed (only if USD data is valid)
    const amountUSD = hasValidUSD ? usdValue * (numAmount / selectedToken.numericBalance) : 0;

    // Fee rates: 0.25% for shield/add, 0.75% for unshield/remove/send
    const feeRate = activeTab === 'shield' ? 0.0025 : 0.0075; // 0.25% = 0.0025, 0.75% = 0.0075
    const feeUSD = hasValidUSD ? amountUSD * feeRate : 0;

    // Gas fees for unshield and transfer operations
    const gasFeeUSD = gasFeeData ? parseFloat(gasFeeData.gasCostUSD) : 0;

    // Total fees = service fee + gas fee
    const totalFeesUSD = feeUSD + gasFeeUSD;

    // Calculate net amounts safely
    let netAmount, netAmountUSD;
    if (hasValidUSD) {
      // Total received/sent = amount - total fees (converted back to token amount)
      netAmount = numAmount - (totalFeesUSD / usdValue * numAmount);
      netAmountUSD = amountUSD - totalFeesUSD;
    } else {
      // Fallback: calculate net amount in tokens only, no USD conversion
      // For token-denominated calculation, we need to estimate fees in tokens
      const protocolFeeInTokens = numAmount * feeRate;
      const gasFeeInTokens = gasFeeData && selectedToken.decimals ?
        parseFloat(gasFeeData.gasCostNative || '0') : 0;
      netAmount = numAmount - protocolFeeInTokens - gasFeeInTokens;
      netAmountUSD = 0; // Will show as "N/A"
    }

    return {
      amountUSD: hasValidUSD ? amountUSD.toFixed(2) : 'N/A',
      feeUSD: hasValidUSD ? feeUSD.toFixed(2) : 'N/A',
      gasFeeUSD: gasFeeData ? gasFeeData.gasCostUSD : null,
      gasCostNative: gasFeeData ? gasFeeData.gasCostNative : null,
      nativeGasToken: gasFeeData ? gasFeeData.nativeGasToken : null,
      feePercent: (feeRate * 100).toFixed(2),
      netAmount: netAmount.toFixed(6),
      netAmountUSD: hasValidUSD ? netAmountUSD.toFixed(2) : 'N/A',
      hasValidUSD
    };
  }, [amount, selectedToken, isValidAmount, activeTab, gasFeeData]);

  // Calculate max amount for Max button (returns precise decimal balance)
  const calculateMaxAmount = useCallback(() => {
    if (!selectedToken) return '0';

    // Use precise wei balance converted to decimal to avoid rounding errors
    try {
      const preciseDecimal = ethers.formatUnits(selectedToken.balance || '0', selectedToken.decimals);
      console.log('[Max Button] Precise balance:', {
        weiBalance: selectedToken.balance,
        decimals: selectedToken.decimals,
        preciseDecimal,
        roundedNumeric: selectedToken.numericBalance
      });
      return preciseDecimal;
    } catch (error) {
      console.warn('[Max Button] Failed to calculate precise amount, falling back to numericBalance:', error);
      return selectedToken.numericBalance.toString();
    }
  }, [selectedToken]);

  // Monitor shield transaction to detect if it gets dropped by provider
  const monitorShieldTransaction = useCallback(async (transactionHash, chainId, provider) => {
    if (!transactionHash || !provider) {
      console.warn('[ShieldMonitor] Missing transaction hash or provider');
      return;
    }

    console.log('[ShieldMonitor] Starting transaction monitoring:', {
      transactionHash: transactionHash.slice(0, 10) + '...',
      chainId
    });

    const maxWaitTime = 30 * 1000; // 30 seconds
    const checkInterval = 10000; // Check every 10 seconds
    const startTime = Date.now();

    const checkTransaction = async () => {
      try {
        const receipt = await provider.getTransactionReceipt(transactionHash);

        if (receipt) {
          // Transaction was mined
          console.log('[ShieldMonitor] Transaction confirmed:', {
            transactionHash: transactionHash.slice(0, 10) + '...',
            blockNumber: receipt.blockNumber,
            status: receipt.status
          });

          if (receipt.status === 0) {
            // Transaction failed on-chain
            console.error('[ShieldMonitor] Transaction failed on-chain');
            toast.custom((t) => (
              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                    <div>
                      <div className="text-sm font-bold">TRANSACTION FAILED</div>
                      <div className="text-xs text-red-400/80 mt-1">Transaction reverted on-chain. Please try again.</div>
                    </div>
                    <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80">×</button>
                  </div>
                </div>
              </div>
            ), { duration: 6000 });
          }
          // Success case is handled by the Graph monitoring system
          return;
        }

        // Check if we've exceeded max wait time
        if (Date.now() - startTime > maxWaitTime) {
          console.warn('[ShieldMonitor] Transaction monitoring timeout reached - letting PrivacyActions handle assumed success');
          // Don't show toast or unlock UI here - let PrivacyActions handle the timeout as assumed success
          return;
        }

        // Continue checking
        setTimeout(checkTransaction, checkInterval);

      } catch (error) {
        console.error('[ShieldMonitor] Error checking transaction:', error);
        // Continue monitoring despite errors
        setTimeout(checkTransaction, checkInterval);
      }
    };

    // Start monitoring
    setTimeout(checkTransaction, checkInterval);
  }, []);

  // Detect recipient address type for smart handling
  const recipientType = useMemo(() => {
    if (!recipientAddress) return 'none';
    const addr = recipientAddress.trim();

    // Validate Ethereum wallet address with proper regex
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return 'eoa';
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

      // Use the entered amount directly - backend handles fee deductions
      const actualAmount = amount;

      // Parse amount to base units
      const amountInUnits = parseTokenAmount(actualAmount, selectedToken.decimals);

      // Get chain configuration
      const chainConfig = { id: chainId };

      console.log('[PrivacyActions] Starting shield operation:', {
        token: selectedToken.symbol,
        amount: actualAmount,
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
      // Allow null addresses for native tokens (ETH, MATIC, BNB)
      const nativeTokenSymbols = ['ETH', 'MATIC', 'BNB'];
      const isNativeToken = !tokenAddr && nativeTokenSymbols.includes(selectedToken.symbol);
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
        gasLimit: result.paddedGasEstimate ? '0x' + BigInt(result.paddedGasEstimate).toString(16) : undefined, // Use padded gas limit for safety
        gasPrice: result.transaction.gasPrice ? '0x' + result.transaction.gasPrice.toString(16) : undefined,
        maxFeePerGas: result.transaction.maxFeePerGas ? '0x' + result.transaction.maxFeePerGas.toString(16) : undefined,
        maxPriorityFeePerGas: result.transaction.maxPriorityFeePerGas ? '0x' + result.transaction.maxPriorityFeePerGas.toString(16) : undefined,
        value: result.transaction.value ? '0x' + result.transaction.value.toString(16) : '0x0',
      };
      
      console.log('[PrivacyActions] Formatted transaction for sending:', txForSending);
      
      // Use signer.sendTransaction instead of provider.request
      const txResponse = await walletSigner.sendTransaction(txForSending);

      console.log('[PrivacyActions] Transaction sent:', txResponse);

      // Monitor transaction to detect if it gets dropped by provider
      const transactionHash = txResponse.hash;
      monitorShieldTransaction(transactionHash, chainId, walletSigner.provider);

      toast.dismiss(toastId);
      toast.custom((t) => (
        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
            <div className="px-4 py-3 flex items-center gap-3">
              <div className="h-3 w-3 rounded-full bg-emerald-400" />
              <div>
                <div className="text-sm">Adding {actualAmount} {selectedToken.symbol} to your vault</div>
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
          maxWaitTime: 30000, // 30 seconds - reasonable timeout before assuming success
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

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for points fallback:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: result.transactionHash,
                  usdValue: usdValue
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
            console.warn('[PrivacyActions] Shield monitoring timed out after 30s - assuming success and proceeding');

            // 🎯 TIMEOUT SUCCESS: Treat timeout as assumed success - run all same logic as confirmed Graph success
            try {
              console.log('[PrivacyActions] 🎯 Processing assumed success after timeout...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for assumed success points');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for assumed success points');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for assumed success:', lexieId);

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for assumed success:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: txResponse?.hash || txResponse,
                  usdValue: usdValue
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded for assumed success (timeout):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Points award failed for assumed success:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Points processing failed for assumed success:', pointsError);
            }

            // Trigger balance refresh for assumed success
            try {
              const { syncBalancesAfterTransaction } = await import('../utils/railgun/syncBalances.js');
              await syncBalancesAfterTransaction({
                walletAddress: address,
                walletId: railgunWalletId,
                chainId,
              });
              console.log('[PrivacyActions] ✅ Balance refresh triggered for assumed success');
            } catch (balanceError) {
              console.warn('[PrivacyActions] ⚠️ Balance refresh failed for assumed success:', balanceError?.message);
            }

            // Show success toast for assumed success
            toast.custom((t) => (
              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div>
                      <div className="text-sm">✅ Shielded {amount} {selectedToken.symbol}</div>
                      <div className="text-xs text-green-400/80">Transaction confirmed - balances updated</div>
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
            ), { duration: 4000 });

            // Dispatch transaction monitor completion event to unlock UI
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('transaction-monitor-complete', {
                detail: { transactionType: 'shield', found: false, elapsedTime: 30000 }
              }));
            }
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
      console.error('[PrivacyActions] Shield operation failed: Network error. Please retry your transaction');
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

      if ((error?.message || '').toLowerCase().includes('rejected') || (error?.message || '').toLowerCase().includes('reject') || error?.code === 4001 || error?.code === 5000) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Transaction rejected by user</div>
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
                  <div className="text-xs text-green-400/80">Network error. Please retry your transaction</div>
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
    // Allow null addresses for native tokens (ETH, MATIC, BNB)
    const nativeTokenSymbols = ['ETH', 'MATIC', 'BNB'];
    const isNativeToken = !tokenAddr && nativeTokenSymbols.includes(selectedToken.symbol);
    if (!tokenAddr && !isNativeToken) {
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

      // Use the entered amount directly - backend handles fee deductions
      const actualAmount = amount;

      // Parse amount to base units
      const amountInUnits = parseTokenAmount(actualAmount, selectedToken.decimals);

      // Get chain configuration
      const chainConfig = { id: chainId };

      // Smart recipient selection
      const toAddress = activeTab === 'unshield' ? address : (recipientAddress || address);

      console.log('[PrivacyActions] Starting unshield operation:', {
        token: selectedToken.symbol,
        tokenAddress: tokenAddr,
        amount: actualAmount,
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
          maxWaitTime: 30000, // 30 seconds - reasonable timeout before assuming success
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

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for unshield points fallback:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: monitorResult.transactionHash,
                  usdValue: usdValue
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
            console.warn('[PrivacyActions] Unshield monitoring timed out after 30s - assuming success and proceeding');

            // 🎯 TIMEOUT SUCCESS: Treat timeout as assumed success - run all same logic as confirmed Graph success
            try {
              console.log('[PrivacyActions] 🎯 Processing assumed success for unshield after timeout...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for assumed unshield success points');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for assumed unshield success points');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for assumed unshield success:', lexieId);

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for assumed unshield success:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: monitorResult.transactionHash,
                  usdValue: usdValue
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded for assumed unshield success (timeout):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Points award failed for assumed unshield success:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Points processing failed for assumed unshield success:', pointsError);
            }

            // Trigger balance refresh for assumed unshield success (same as successful case)
            try {
              const { syncBalancesAfterTransaction } = await import('../utils/railgun/syncBalances.js');
              await syncBalancesAfterTransaction({
                walletAddress: address,
                walletId: railgunWalletId,
                chainId,
              });
              console.log('[PrivacyActions] ✅ Balance refresh triggered for assumed unshield success');
            } catch (balanceError) {
              console.warn('[PrivacyActions] ⚠️ Balance refresh failed for assumed unshield success:', balanceError?.message);
            }

            // Dispatch railgun-public-refresh event to unlock modal (same as successful transaction flow)
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('railgun-public-refresh', { detail: { chainId } }));
            }

            // Show success toast for assumed unshield success
            toast.custom((t) => (
              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div>
                      <div className="text-sm">✅ Unshielded {amount} {selectedToken.symbol}</div>
                      <div className="text-xs text-green-400/80">Transaction confirmed - balances updated</div>
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
            ), { duration: 4000 });
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

      // Check for specific gas reclamation pricing error
      if (error.message && error.message.includes('Cannot calculate gas reclamation: no price available for fee token')) {
        // Custom terminal-themed error toast for insufficient balance
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <div className="text-sm font-bold">TRANSACTION FAILED</div>
                  <div className="text-xs text-red-400/80 mt-1">Balance is too low to pay for the fees. Please increase the amount for the transaction.</div>
                </div>
                <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80">×</button>
              </div>
            </div>
          </div>
        ), { duration: 8000 });
        return;
      }

      // Check for insufficient funds error
      if (error.message && error.message.includes("You don't have enough funds to cover the fees")) {
        // Custom terminal-themed error toast for insufficient funds
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <div className="text-sm font-bold">TRANSACTION FAILED</div>
                  <div className="text-xs text-red-400/80 mt-1">Insufficient funds to cover transaction fees. Please try a larger transaction amount.</div>
                </div>
                <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80">×</button>
              </div>
            </div>
          </div>
        ), { duration: 8000 });
        return;
      }

      // Check for specific SnarkJS proof generation failure
      else if (error.message && error.message.includes('SnarkJS failed to fullProveRailgun')) {
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <div className="text-sm font-bold">TRANSACTION FAILED</div>
                  <div className="text-xs text-red-400/80 mt-1">Max amount exceeds available vault balance. Please try again with a slightly lower amount.</div>
                </div>
                <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80">×</button>
              </div>
            </div>
          </div>
        ), { duration: 8000 });
      } else {
        // Show generic error for other failures
        toast.custom((t) => (
          <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-red-500/30 bg-black/90 text-red-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <div className="text-sm font-bold">TRANSACTION FAILED</div>
                  <div className="text-xs text-red-400/80 mt-1">{error.message || 'Unknown error occurred'}</div>
                </div>
                <button type="button" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); toast.dismiss(t.id); }} className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-red-900/30 text-red-300/80">×</button>
              </div>
            </div>
          </div>
        ), { duration: 8000 });
      }

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

    // Check if recipient is a saved contact for enhanced UI feedback
    const savedContact = findContactByAddress(recipientAddress);
    const contactDisplayName = savedContact ? savedContact.id : null;

    // Allow Railgun address (0zk...) OR Lexie ID (3-20 alphanumeric/_)
    if (!isValidRailgunAddress(recipientAddress)) {
      const input = (recipientAddress || '').trim().toLowerCase();
      const isLikelyLexieID = /^[a-z0-9_]{3,20}$/.test(input);
      if (!isLikelyLexieID) {
        toast.error('Please enter a valid EVM address or a LexieID');
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
                    <div className="text-sm">LexieID does not exist or is not linked to a LexieVault</div>
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
                    <div className="text-sm">LexieID does not exist or is not linked to a LexieVault</div>
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
                  <div className="text-sm">LexieID does not exist or is not linked to a LexieVault</div>
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
                <div className="text-sm">
                  Preparing transaction…
                  {contactDisplayName && (
                    <span className="ml-2 text-xs bg-green-900/30 text-green-300 px-1.5 py-0.5 rounded">
                      to {contactDisplayName}
                    </span>
                  )}
                </div>
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

      // Use the entered amount directly - backend handles fee deductions
      const actualAmount = amount;

      const amountInUnits = parseTokenAmount(actualAmount, selectedToken.decimals);
      const tokenAddr = getTokenAddress(selectedToken);
      // Allow null addresses for native tokens (ETH, MATIC, BNB)
      const nativeTokenSymbols = ['ETH', 'MATIC', 'BNB'];
      const isNativeToken = !tokenAddr && nativeTokenSymbols.includes(selectedToken.symbol);

      if (!tokenAddr && !isNativeToken) {
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
                <div className="text-sm">
                  Transaction sent
                  {contactDisplayName && (
                    <span className="ml-2 text-xs bg-green-900/30 text-green-300 px-1.5 py-0.5 rounded">
                      to {contactDisplayName}
                    </span>
                  )}
                </div>
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
          maxWaitTime: 30000, // 30 seconds - reasonable timeout before assuming success
          transactionDetails: {
            walletId: railgunWalletId,
            walletAddress: address,
            railgunAddress: railgunAddress,
            tokenSymbol: selectedToken.symbol,
            tokenAddress: tokenAddr,
            decimals: selectedToken.decimals,
            amount: amountInUnits,
            displayAmount: actualAmount,
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

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for transfer points fallback:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: tx.txHash,
                  usdValue: usdValue
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
          } else {
            console.warn('[PrivacyActions] Transfer monitoring timed out after 30s - assuming success and proceeding');

            // 🎯 TIMEOUT SUCCESS: Treat timeout as assumed success - run all same logic as confirmed Graph success
            try {
              console.log('[PrivacyActions] 🎯 Processing assumed success for transfer after timeout...');

              // First resolve Lexie ID from Railgun address
              const lexieResponse = await fetch('/api/wallet-metadata?action=by-wallet&railgunAddress=' + encodeURIComponent(railgunAddress));
              if (!lexieResponse.ok) {
                console.warn('[PrivacyActions] Could not resolve Lexie ID for assumed transfer success points');
                return;
              }

              const lexieData = await lexieResponse.json();
              if (!lexieData?.success || !lexieData?.lexieID) {
                console.warn('[PrivacyActions] No Lexie ID found for assumed transfer success points');
                return;
              }

              const lexieId = lexieData.lexieID.toLowerCase();
              console.log('[PrivacyActions] ✅ Resolved Lexie ID for assumed transfer success:', lexieId);

              // Calculate actual USD value for points
              const amountInUnitsForPoints = parseTokenAmount(actualAmount, selectedToken.decimals);
              const transactionMonitor = await import('../utils/railgun/transactionMonitor.js');
              const convertTokenAmountToUSD = transactionMonitor.default.convertTokenAmountToUSD;
              const usdValue = await convertTokenAmountToUSD(amountInUnitsForPoints, tokenAddr, chainId);

              console.log('[PrivacyActions] 💰 Calculated USD value for assumed transfer success:', {
                amount: actualAmount,
                amountInUnits: amountInUnitsForPoints,
                tokenAddress: tokenAddr,
                chainId,
                usdValue
              });

              // Now call rewards-award with correct format
              const pointsResponse = await fetch('/api/wallet-metadata?action=rewards-award', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  lexieId: lexieId,
                  txHash: tx.txHash,
                  usdValue: usdValue
                })
              });

              if (pointsResponse.ok) {
                const pointsData = await pointsResponse.json();
                if (pointsData?.success) {
                  console.log('[PrivacyActions] ✅ Points awarded for assumed transfer success (timeout):', {
                    awarded: pointsData.awarded,
                    balance: pointsData.balance,
                    multiplier: pointsData.multiplier
                  });
                  // Refresh points display with small delay to ensure backend processing is complete
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('points-updated'));
                  }, 500);
                }
              } else {
                console.warn('[PrivacyActions] Points award failed for assumed transfer success:', await pointsResponse.text());
              }
            } catch (pointsError) {
              console.warn('[PrivacyActions] Points processing failed for assumed transfer success:', pointsError);
            }

            // Trigger balance refresh for assumed transfer success
            try {
              const { syncBalancesAfterTransaction } = await import('../utils/railgun/syncBalances.js');
              await syncBalancesAfterTransaction({
                walletAddress: address,
                walletId: railgunWalletId,
                chainId,
              });
              console.log('[PrivacyActions] ✅ Balance refresh triggered for assumed transfer success');
            } catch (balanceError) {
              console.warn('[PrivacyActions] ⚠️ Balance refresh failed for assumed transfer success:', balanceError?.message);
            }

            // Show success toast for assumed transfer success
            toast.custom((t) => (
              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                    <div>
                      <div className="text-sm">✅ Transferred {amount} {selectedToken.symbol}</div>
                      <div className="text-xs text-green-400/80">Transaction confirmed - balances updated</div>
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
            ), { duration: 4000 });
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
      if (msg.includes('rejected') || msg.includes('reject') || error?.code === 4001 || error?.code === 5000) {
        toast.custom((t) => (
          <div className={`font-mono ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
            <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
              <div className="px-4 py-3 flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-400" />
                <div>
                  <div className="text-sm">Transaction rejected by user</div>
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

      {/* Vault Balances - hide on Receive and Contacts tabs */}
      {activeTab !== 'receive' && activeTab !== 'contacts' && (
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
        ) : activeTab === 'contacts' ? (
          // Contacts Manager
          <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
              <UsersIcon className="h-12 w-12 text-green-300 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-green-300 mb-1">Contacts Manager</h3>
              <p className="text-sm text-green-400/70">Save frequently used addresses for easy sending</p>
            </div>

            {/* Add Contact Button */}
            <button
              onClick={() => {
                setShowAddContactModal(true);
                setEditingContact(null);
              }}
              className="w-full bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 py-3 px-4 rounded font-medium transition-colors border border-emerald-400/40 flex items-center justify-center gap-2"
            >
              <UsersIcon className="h-4 w-4" />
              Add New Contact
            </button>

            {/* Contacts List */}
            {contacts.length === 0 ? (
              <div className="text-center py-8">
                <UsersIcon className="h-16 w-16 text-green-400/30 mx-auto mb-4" />
                <p className="text-green-400/70">No contacts saved yet</p>
                <p className="text-sm text-green-400/50 mt-1">Add your first contact to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {contacts.map((contact) => (
                  <div key={contact.id} className="bg-black/40 border border-green-500/20 rounded p-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-green-200">{contact.id}</span>
                          <span className="text-xs text-green-400/70 bg-green-900/30 px-2 py-0.5 rounded">
                            {contact.type === 'lexieId' ? 'LexieID' : 'WALLET'}
                          </span>
                        </div>
                        <div
                          className="text-sm text-green-300 font-mono break-all cursor-pointer hover:text-green-200 transition-colors select-all"
                          onClick={() => {
                            const address = contact.type === 'eoa' ? contact.address : contact.lexieId;
                            navigator.clipboard.writeText(address);
                            toast.custom((t) => (
                              <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                                <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                                  <div className="px-4 py-3 flex items-center gap-3">
                                    <div className="h-3 w-3 rounded-full bg-green-400" />
                                    <div>
                                      <div className="text-sm">Address copied to clipboard</div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ), { duration: 2000 });
                          }}
                          title="Click to copy"
                        >
                          {contact.type === 'eoa' ? contact.address : contact.lexieId}
                        </div>
                      </div>
                      <div className="flex gap-2 ml-3">
                        <button
                          onClick={() => {
                            setEditingContact(contact);
                            setShowAddContactModal(true);
                          }}
                          className="text-green-400 hover:text-green-300 text-xs px-2 py-1 border border-green-500/40 rounded hover:bg-green-900/20"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeContact(contact.id)}
                          className="text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-500/40 rounded hover:bg-red-900/20"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
                className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                disabled={!selectedToken}
              />
              {selectedToken && (
              <button
                type="button"
                onClick={() => {
                  // Set the full available balance - backend handles fee deductions
                  setAmount(calculateMaxAmount());
                }}
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
            {exceedsAvailableBalance && (
              <p className="mt-1 text-sm text-red-400">
                You've entered more than your available balance
              </p>
            )}

            {/* Fee Display */}
            {feeInfo && (
              <div className="mt-3 p-3 bg-black/40 border border-green-500/20 rounded text-xs">
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-green-400/80">Network Fees:</span>
                    <span className="text-green-200">{feeInfo.feeUSD === 'N/A' ? 'N/A' : `$${feeInfo.feeUSD}`}</span>
                  </div>
                  {feeInfo.gasFeeUSD && activeTab !== 'shield' && (
                    <div className="flex justify-between border-b border-green-500/20 pb-1 mb-1">
                      <span className="text-green-400/80">Est. Gas Fees:</span>
                      <span className="text-green-200">({feeInfo.gasCostNative} {feeInfo.nativeGasToken}) ${feeInfo.gasFeeUSD}</span>
                    </div>
                  )}
                  {feeInfo.gasFeeUSD && activeTab !== 'shield' && feeInfo.feeUSD !== 'N/A' && (
                    <div className="flex justify-between">
                      <span className="text-green-400/80">Est. Total Fees:</span>
                      <span className="text-green-200">${(parseFloat(feeInfo.feeUSD) + parseFloat(feeInfo.gasFeeUSD)).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-medium">
                    <span className="text-green-300">
                      {feeInfo.gasFeeUSD && activeTab !== 'shield' ? 'Est. ' : ''}Total {activeTab === 'shield' ? 'Added' : activeTab === 'unshield' ? 'Received' : 'Sent'}:
                    </span>
                    <span className="text-emerald-300">
                      ({feeInfo.netAmount} {selectedToken.symbol}){feeInfo.netAmountUSD === 'N/A' ? '' : ` $${feeInfo.netAmountUSD}`}
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
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-green-300">
                    Send To
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowContactSelectionModal(true)}
                    className="text-xs text-green-400 hover:text-green-300 px-2 py-1 border border-green-500/40 rounded hover:bg-green-900/20 transition-colors flex items-center gap-1"
                    title="Select from contacts"
                  >
                    <UsersIcon className="h-3 w-3" />
                    Contacts
                  </button>
                </div>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => {
                    const rawInput = e.target.value;
                    const trimmedInput = rawInput.trim();

                    // Check if raw input differs from trimmed version (has leading/trailing spaces)
                    if (rawInput !== trimmedInput) {
                      // Show warning toast about spaces being removed
                      toast.custom((t) => (
                        <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
                          <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl">
                            <div className="px-4 py-3 flex items-center gap-3">
                              <div className="h-3 w-3 rounded-full bg-yellow-400" />
                              <div>
                                <div className="text-sm">Extra spaces removed from wallet address</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ), { duration: 3000 });
                    }

                    // Always set the trimmed value
                    setRecipientAddress(trimmedInput);

                    // Update contact suggestions for autocomplete
                    if (trimmedInput.trim()) {
                      const matches = searchContacts(trimmedInput, 5);
                      setContactSuggestions(matches);
                      setShowSuggestions(matches.length > 0);
                    } else {
                      setContactSuggestions([]);
                      setShowSuggestions(false);
                    }
                  }}
                  placeholder="0x...or LexieID"
                  className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                />
                <div className="mt-1 text-xs text-green-400/70">
                  {recipientType === 'eoa' && 'Will send to public address'}
                  {recipientType === 'railgun' && 'Will send to zk-shielded address (0zk...)'}
                  {recipientType === 'lexie' && 'Will send to LexieID'}
                  {recipientType === 'invalid' && recipientAddress && '❌ Invalid address format'}
                  {recipientType === 'none' && 'Enter recipient address or LexieID'}
                </div>

                {/* Contact Suggestions Dropdown */}
                {showSuggestions && contactSuggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-black border border-green-500/40 rounded shadow-xl max-h-40 overflow-auto">
                    {contactSuggestions.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => {
                            setRecipientAddress(contact.type === 'eoa' ? contact.address || '' : contact.lexieId || '');
                            setShowSuggestions(false);
                            setContactSuggestions([]);
                          }}
                        className="w-full text-left px-3 py-2 hover:bg-emerald-900/30 focus:bg-emerald-900/30 focus:outline-none text-green-200"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-medium">{contact.id}</span>
                          <span className="text-xs text-green-400/70 ml-2">
                            ({contact.type === 'lexieId' ? 'LexieID' : 'WALLET'})
                          </span>
                        </div>
                        <div className="text-xs text-green-400/60 truncate">
                          {contact.type === 'eoa' ? contact.address : contact.lexieId}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Add Contact Prompt */}
                {recipientAddress && !showSuggestions && !contacts.some(c => c.address === recipientAddress || c.id === recipientAddress || c.lexieId === recipientAddress) && (
                  <div className="mt-2 text-xs text-green-400/70">
                    Not in contacts.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddContactModal(true);
                        setEditingContact(null);
                      }}
                      className="text-green-300 hover:text-green-200 underline"
                    >
                      [Add?]
                    </button>
                  </div>
                )}
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
            disabled={!isValidAmount || exceedsAvailableBalance || isProcessing || isTransactionLocked || !selectedToken || (!gasFeeData && activeTab !== 'shield') || (activeTab === 'transfer' && (!recipientAddress || recipientType === 'invalid'))}
            className={`w-full py-3 px-4 rounded font-medium transition-colors ${
              isValidAmount && !exceedsAvailableBalance && !isProcessing && !isTransactionLocked && selectedToken && (gasFeeData || activeTab === 'shield') && (activeTab !== 'transfer' || (recipientAddress && recipientType !== 'invalid'))
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

      {/* Contact Modal */}
      {showAddContactModal && (
        <ContactModal
          contact={editingContact}
          onSave={async (contact) => {
            if (editingContact) {
              await updateContact(editingContact.id, contact);
            } else {
              await addContact(contact);
            }
            setShowAddContactModal(false);
            setEditingContact(null);
          }}
          onCancel={() => {
            setShowAddContactModal(false);
            setEditingContact(null);
          }}
          prefillAddress={editingContact ? undefined : recipientAddress}
        />
      )}

      {/* Contact Selection Modal */}
      {showContactSelectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4 font-mono">
          <div className="bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span className="w-3 h-3 rounded-full bg-green-500" />
                </div>
                <span className="text-sm tracking-wide text-gray-400">select-contact</span>
              </div>
              <button
                onClick={() => setShowContactSelectionModal(false)}
                className="text-green-400/70 hover:text-green-300 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 text-green-300 space-y-4 max-h-96 overflow-y-auto">
              <div>
                <h3 className="text-lg font-bold text-emerald-300 mb-2">Select Contact</h3>
                <p className="text-green-400/80 text-sm mb-4">
                  Choose a contact to send to
                </p>
              </div>

              {contacts.length === 0 ? (
                <div className="text-center py-8 text-green-400/70">
                  <UsersIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No contacts yet</p>
                  <p className="text-xs mt-2">Add contacts in the Contacts tab</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {contacts.map((contact) => (
                    <button
                      key={contact.id}
                      onClick={() => {
                        // Prefill recipient address with contact's address or LexieID
                        const recipientValue = contact.lexieId || contact.address;
                        setRecipientAddress(recipientValue);
                        setShowContactSelectionModal(false);

                        // Clear any existing suggestions
                        setContactSuggestions([]);
                        setShowSuggestions(false);
                      }}
                      className="w-full text-left p-3 bg-black/40 border border-green-500/20 rounded hover:bg-green-900/20 hover:border-green-500/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="text-green-200 font-medium truncate">
                            {contact.name || contact.id}
                          </div>
                          <div className="text-green-400/70 text-xs truncate">
                            {contact.lexieId ? `@${contact.lexieId}` : contact.address}
                          </div>
                        </div>
                        <div className="text-green-400/70 text-xs ml-2">
                          {contact.lexieId ? 'LexieID' : 'Address'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                <button
                  onClick={() => setShowContactSelectionModal(false)}
                  className="px-4 py-2 text-sm border border-gray-600 text-gray-300 rounded hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default PrivacyActions; 

