/**
 * Payment Page - External users can fund a vault via payment link
 * Integrates shieldTransactions.js with Chainalysis screening
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  WalletIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ArrowDownIcon,
} from '@heroicons/react/24/outline';

import TerminalWindow from '../components/ui/TerminalWindow';

import { useWallet } from '../contexts/WalletContext';
import useInjectedProviders from '../hooks/useInjectedProviders';
import InjectedProviderButtons from '../components/InjectedProviderButtons.jsx';
// Client-only shield flow (avoid initializing recipient vault)
import { assertNotSanctioned } from '../utils/sanctions/chainalysis-oracle';
import { isTokenSupportedByRailgun } from '../utils/railgun/actions';
import { TXIDVersion, EVMGasType, NetworkName, getEVMGasTypeForTransaction } from '@railgun-community/shared-models';
import { gasEstimateForShield, populateShield } from '@railgun-community/wallet';
import { Contract, parseUnits } from 'ethers';
import { fetchTokenPrices } from '../utils/pricing/coinGecko';

// Terminal-themed toast helper (matches tx-unshield.js and PrivacyActions.jsx)
const showTerminalToast = (type, title, subtitle = '', opts = {}) => {
  if (subtitle && typeof subtitle === 'object' && !Array.isArray(subtitle)) {
    opts = subtitle;
    subtitle = '';
  }
  const color = type === 'error' ? 'bg-red-400' : type === 'success' ? 'bg-emerald-400' : 'bg-yellow-400';
  return toast.custom((t) => (
    <div className={`font-mono pointer-events-auto ${t.visible ? 'animate-enter' : 'animate-leave'}`}>
      <div className="rounded-lg border border-green-500/30 bg-black/90 text-green-200 shadow-2xl max-w-sm">
        <div className="px-4 py-3 flex items-center gap-3">
          <div className={`h-3 w-3 rounded-full ${color}`} />
          <div>
            <div className="text-sm">{title}</div>
            {subtitle ? <div className="text-xs text-green-400/80">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); toast.dismiss(t.id); }}
            className="ml-2 h-5 w-5 flex items-center justify-center rounded hover:bg-green-900/30 text-green-300/80"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  ), { duration: type === 'error' ? 4000 : 2500, ...opts });
};

// Calculate USD value for a balance (similar to useBalances hook)
const calculateUSDValue = (numericBalance, symbol, prices) => {
  // Resolve common wrapper/alias symbols to their base asset prices if needed
  const aliasMap = {
    WETH: 'ETH',
    WMATIC: 'MATIC',
    WBNB: 'BNB',
    'USDC.e': 'USDC',
  };
  const resolvedSymbol = prices[symbol] != null ? symbol : (aliasMap[symbol] || symbol);
  const price = prices[resolvedSymbol];
  if (price && typeof price === 'number' && numericBalance > 0) {
    return (numericBalance * price).toFixed(2);
  }
  return undefined;
};

// Format balance similar to useBalances hook
const formatBalance = (balance, decimals = 2) => {
  if (typeof balance !== 'number') return '0.00';
  if (balance === 0) return '0.00';
  if (balance < 0.001) return '<0.001';
  if (balance < 1) return balance.toFixed(Math.min(decimals + 2, 6));
  return balance.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const PaymentPage = () => {
  const [searchParams] = useSearchParams();
  const toParam = searchParams.get('to');
  const chainIdParam = searchParams.get('chainId');
  const preferredToken = searchParams.get('token');

  const {
    isConnected,
    address,
    chainId,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    walletProvider,
    ensureEngineForShield,
  } = useWallet();

  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [publicBalances, setPublicBalances] = useState([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);
  const [isTokenMenuOpen, setIsTokenMenuOpen] = useState(false);
  const [tokenPrices, setTokenPrices] = useState({});
  const tokenMenuRef = useRef(null);

  // Parse target chain ID
  const targetChainId = chainIdParam ? parseInt(chainIdParam) : 1;

  // Network configurations
  const networks = {
    1: { name: 'Ethereum', symbol: 'ETH' },
    137: { name: 'Polygon', symbol: 'MATIC' },
    42161: { name: 'Arbitrum', symbol: 'ETH' },
    56: { name: 'BNB Chain', symbol: 'BNB' },
  };

  // Recipient resolution: support Railgun address (0zk...) or Lexie ID
  const [resolvedRecipientAddress, setResolvedRecipientAddress] = useState(null);
  const [recipientResolveError, setRecipientResolveError] = useState(null);

  // Check if user is on correct network
  const isCorrectNetwork = chainId === targetChainId;

  // Suppress vault init on PaymentPage and prepare light engine
  useEffect(() => {
    try { if (typeof window !== 'undefined') window.__LEXIE_SUPPRESS_RAILGUN_INIT = true; } catch {}
    return () => { try { if (typeof window !== 'undefined') delete window.__LEXIE_SUPPRESS_RAILGUN_INIT; } catch {} };
  }, []);

  // Fetch public balances when connected and on correct network
  useEffect(() => {
    if (!isConnected || !address || !isCorrectNetwork) {
      setPublicBalances([]);
      return;
    }

    const fetchBalances = async () => {
      setIsLoadingBalances(true);
      try {
        // Ensure light Railgun engine is up (no wallet init)
        await ensureEngineForShield().catch(() => {});

        // Fetch token prices first
        const symbols = ['ETH', 'USDC', 'USDT', 'DAI', 'MATIC', 'BNB', 'WETH', 'WMATIC', 'WBNB', 'USDC.e'];
        try {
          const prices = await fetchTokenPrices(symbols);
          setTokenPrices(prices);
        } catch (priceError) {
          console.warn('[PaymentPage] Failed to fetch token prices:', priceError);
        }

        // Use ethers to get balances directly
        const provider = await walletProvider();
        const providerInstance = provider.provider;
        const ethersLib = await import('ethers');

        // Common tokens per chain
        const commonTokens = {
          1: [ // Ethereum
            { symbol: 'ETH', address: null, name: 'Ethereum', decimals: 18 },
            { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: 'USD Coin', decimals: 6 },
            { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether USD', decimals: 6 },
            { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: 'Dai Stablecoin', decimals: 18 },
          ],
          137: [ // Polygon
            { symbol: 'MATIC', address: null, name: 'Polygon', decimals: 18 },
            { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USD Coin', decimals: 6 },
            { symbol: 'USDT', address: '0xc2132D05D31c914a87C6611c10748AEb04B58e8F', name: 'Tether USD', decimals: 6 },
          ],
          42161: [ // Arbitrum
            { symbol: 'ETH', address: null, name: 'Ethereum', decimals: 18 },
            // Native USDC
            { symbol: 'USDC', address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', name: 'USD Coin', decimals: 6 },
            // Bridged USDC.e
            { symbol: 'USDC.e', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', name: 'USD Coin (USDC.e)', decimals: 6 },
            { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', name: 'Tether USD', decimals: 6 },
          ],
          56: [ // BNB Chain
            { symbol: 'BNB', address: null, name: 'BNB', decimals: 18 },
            { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', name: 'Tether USD', decimals: 18 },
            { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', name: 'USD Coin', decimals: 18 },
          ],
        };

        const tokens = commonTokens[chainId] || [
          { symbol: networks[chainId]?.symbol || 'ETH', address: null, name: networks[chainId]?.name || 'Ethereum', decimals: 18 }
        ];

        // Get native token balance
        const nativeBalance = await providerInstance.getBalance(address);
        
        const balancesWithData = await Promise.all(
          tokens.map(async (token) => {
            try {
              let balance = '0';
              if (!token.address) {
                // Native token
                balance = nativeBalance.toString();
              } else {
                // ERC20 token balance via minimal ABI
                const erc20Abi = ['function balanceOf(address) view returns (uint256)'];
                const contract = new ethersLib.Contract(token.address, erc20Abi, providerInstance);
                const erc20Bal = await contract.balanceOf(address);
                balance = erc20Bal.toString();
              }
              const numericBalance = Number(ethersLib.formatUnits(balance, token.decimals));
              const balanceUSD = calculateUSDValue(numericBalance, token.symbol, tokenPrices);
              return {
                ...token,
                numericBalance: Number(numericBalance.toFixed(6)),
                hasBalance: Number(numericBalance) > 0,
                balanceUSD,
              };
            } catch (error) {
              console.warn(`Failed to get balance for ${token.symbol}:`, error);
              return {
                ...token,
                numericBalance: 0,
                hasBalance: false,
                balanceUSD: undefined,
              };
            }
          })
        );

        setPublicBalances(
          balancesWithData
            .filter(token => isTokenSupportedByRailgun(token.address, chainId))
            // Prefer native USDC over USDC.e when both present
            .filter((t, idx, arr) => {
              if (chainId !== 42161) return true;
              if (t.symbol !== 'USDC.e') return true;
              const hasNativeUSDC = arr.some(x => x.symbol === 'USDC');
              return !hasNativeUSDC;
            })
        );
      } catch (error) {
        console.error('Failed to fetch balances:', error);
        // Fallback to basic token structure
        const fallbackSymbol = networks[chainId]?.symbol || 'ETH';
        setPublicBalances([
          {
            symbol: fallbackSymbol,
            address: null,
            name: networks[chainId]?.name || 'Ethereum',
            numericBalance: 0,
            decimals: 18,
            balanceUSD: undefined,
          }
        ]);
      } finally {
        setIsLoadingBalances(false);
      }
    };

    fetchBalances();
  }, [isConnected, address, chainId, isCorrectNetwork, walletProvider]);

  // Auto-select preferred token or first available
  useEffect(() => {
    if (publicBalances.length === 0) return;

    if (preferredToken) {
      const token = publicBalances.find(t => 
        (t.address || '').toLowerCase() === preferredToken.toLowerCase()
      );
      if (token) {
        setSelectedToken(token);
        return;
      }
    }

    // Select first token with balance or just the first token
    const tokenWithBalance = publicBalances.find(t => t.numericBalance > 0);
    setSelectedToken(tokenWithBalance || publicBalances[0]);
  }, [publicBalances, preferredToken]);

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

  // Handle payment processing
  const handlePayment = async (e) => {
    e.preventDefault();
    
    if (!selectedToken || !amount || parseFloat(amount) <= 0) {
      showTerminalToast('error', 'Please select a token and enter a valid amount');
      return;
    }

    if (!isConnected || !address) {
      showTerminalToast('error', 'Please connect your wallet first');
      return;
    }

    if (!isCorrectNetwork) {
      showTerminalToast('error', `Please switch to ${networks[targetChainId]?.name || 'the correct network'}`);
      return;
    }

    setIsProcessing(true);

    showTerminalToast('info', 'Starting Deposit', 'Preparing your private vault deposit...', { duration: 2000 });

    try {
      // Sanctions screening for the payer (current user)
      console.log('[PaymentPage] Screening payer wallet:', address);
      await assertNotSanctioned(chainId, address);
      console.log('[PaymentPage] Payer screening passed');
      // Only support ERC-20 for payment page flow
      if (!selectedToken.address) {
        throw new Error('Native token shielding is not supported on this payment flow. Please select an ERC-20 token.');
      }

      // Check token support
      if (!isTokenSupportedByRailgun(selectedToken.address, chainId)) {
        throw new Error(`${selectedToken.symbol} is not supported on this network`);
      }

      // Check sufficient balance
      const requestedAmount = parseFloat(amount);
      if (selectedToken.numericBalance < requestedAmount) {
        throw new Error(`Insufficient balance. Available: ${selectedToken.numericBalance} ${selectedToken.symbol}`);
      }

      // Connect signer and gather network info
      const signer = await walletProvider();
      const payerEOA = await signer.getAddress();
      const provider = signer.provider;

      // Map chainId to Railgun NetworkName
      const railgunNetwork = {
        1: NetworkName.Ethereum,
        42161: NetworkName.Arbitrum,
        137: NetworkName.Polygon,
        56: NetworkName.BNBChain,
      }[chainId];
      if (!railgunNetwork) throw new Error(`Unsupported network: ${chainId}`);

      // Parse amount to base units
      const weiAmount = parseUnits(amount, selectedToken.decimals);

      // Prepare recipients (use resolved Railgun address)
      const erc20AmountRecipients = [
        { tokenAddress: selectedToken.address, amount: weiAmount, recipientAddress: resolvedRecipientAddress },
      ];

      // Create ephemeral shield private key
      const getRandomHex32 = () => {
        const bytes = new Uint8Array(32);
        (window.crypto || globalThis.crypto).getRandomValues(bytes);
        return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      };
      const shieldPrivateKey = getRandomHex32();

      // Determine gas type and preliminary gas details (to discover spender address)
      const evmGasType = getEVMGasTypeForTransaction(railgunNetwork, true);
      const feeData = await provider.getFeeData();
      let prelimGasDetails;
      if (evmGasType === EVMGasType.Type2) {
        prelimGasDetails = {
          evmGasType,
          gasEstimate: BigInt(300000),
          maxFeePerGas: feeData.maxFeePerGas || BigInt('1000000'),
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || BigInt('100000'),
        };
      } else {
        prelimGasDetails = {
          evmGasType,
          gasEstimate: BigInt(300000),
          gasPrice: feeData.gasPrice || BigInt('1000000'),
        };
      }

      // Build a preliminary shield tx to get the RAILGUN shield contract (spender)
      const { transaction: prelimTx } = await populateShield(
        TXIDVersion.V2_PoseidonMerkle,
        railgunNetwork,
        shieldPrivateKey,
        erc20AmountRecipients,
        [],
        prelimGasDetails,
      );
      const spender = prelimTx.to;
      if (!spender) throw new Error('Failed to resolve Railgun shield contract address');

      // Ensure ERC-20 allowance
      const erc20Abi = [
        'function allowance(address owner,address spender) view returns (uint256)',
        'function approve(address spender,uint256 amount) returns (bool)',
      ];
      const erc20 = new Contract(selectedToken.address, erc20Abi, signer);
      const currentAllowance = await erc20.allowance(payerEOA, spender);
      if (currentAllowance < weiAmount) {
        showTerminalToast('info', 'Approval Required', 'Please sign the token approval in your wallet to allow the deposit', { duration: 4000 });
        const approveTx = await erc20.approve(spender, weiAmount);
        await approveTx.wait();
      }

      // Final gas estimate for shield
      const { gasEstimate } = await gasEstimateForShield(
        TXIDVersion.V2_PoseidonMerkle,
        railgunNetwork,
        shieldPrivateKey,
        erc20AmountRecipients,
        [],
        payerEOA,
      );

      // Final gas details
      const refreshedFee = await provider.getFeeData();
      let gasDetails;
      if (evmGasType === EVMGasType.Type2) {
        gasDetails = {
          evmGasType,
          gasEstimate,
          maxFeePerGas: refreshedFee.maxFeePerGas || feeData.maxFeePerGas || BigInt('1000000'),
          maxPriorityFeePerGas: refreshedFee.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas || BigInt('100000'),
        };
      } else {
        gasDetails = {
          evmGasType,
          gasEstimate,
          gasPrice: refreshedFee.gasPrice || feeData.gasPrice || BigInt('1000000'),
        };
      }

      // Build final shield transaction
      const { transaction } = await populateShield(
        TXIDVersion.V2_PoseidonMerkle,
        railgunNetwork,
        shieldPrivateKey,
        erc20AmountRecipients,
        [],
        gasDetails,
      );
      transaction.from = payerEOA;

      // Send from payer's EOA
      showTerminalToast('info', 'Deposit Transaction', 'Please sign the deposit transaction in your wallet', { duration: 4000 });
      const sent = await signer.sendTransaction(transaction);

      showTerminalToast('info', 'Transaction Submitted', 'Waiting for blockchain confirmation...', { duration: 3000 });
      const receipt = await sent.wait();

      showTerminalToast('success', 'Payment sent', `Deposited ${amount} ${selectedToken.symbol} to recipient's vault. TX: ${sent.hash}`, { duration: 6000 });

      // Reset form amount
      setAmount('');
      
    } catch (error) {
      console.error('[PaymentPage] Payment failed:', error);
      
      if (error.message.includes('sanctions') || error.message.includes('sanctioned')) {
        showTerminalToast('error', 'Transaction blocked', 'Address appears on sanctions list');
      } else if (error.code === 4001 || /rejected/i.test(error?.message || '')) {
        showTerminalToast('error', 'Transaction cancelled by user');
      } else {
        showTerminalToast('error', `Payment failed: ${error.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle network switch
  const handleNetworkSwitch = async () => {
    try {
      await switchNetwork(targetChainId);
      showTerminalToast('success', `Switched to ${networks[targetChainId]?.name || 'target network'}`);
    } catch (error) {
      showTerminalToast('error', `Failed to switch network: ${error.message}`);
    }
  };

  // Do not early-return anymore; we'll show any error state within the page UI

  // Resolve recipient from `to` param; allow Lexie ID or Railgun address
  const [recipientLexieId, setRecipientLexieId] = useState(null);
  useEffect(() => {
    const resolveRecipient = async () => {
      setRecipientResolveError(null);
      setResolvedRecipientAddress(null);
      setRecipientLexieId(null);
      if (!toParam) { setRecipientResolveError('Missing recipient'); return; }

      const lexiePattern = /^[a-zA-Z0-9_]{3,20}$/;
      try {
        if (toParam.startsWith('0zk')) {
          // Direct Railgun address
          setResolvedRecipientAddress(toParam);
          // Try to fetch Lexie ID for display
          try {
            const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(toParam)}`);
            const json = await resp.json().catch(() => ({}));
            if (resp.ok && json?.success && json?.lexieID) setRecipientLexieId(json.lexieID);
          } catch {}
        } else if (lexiePattern.test(toParam)) {
          // Lexie ID: resolve to Railgun address
          const idLower = toParam.toLowerCase();
          // Immediately show the ID from the link while we resolve it
          setRecipientLexieId(idLower);
          const primary = await fetch(`/api/wallet-metadata?action=lexie-resolve&lexieID=${encodeURIComponent(idLower)}`);
          let resolved = null;
          if (primary.ok) {
            const json = await primary.json().catch(() => ({}));
            resolved = json?.walletAddress || json?.address || null;
          }
          if (!resolved || !String(resolved).startsWith('0zk')) {
            // Fallback: use history resolver which supports multiple identifiers
            try {
              const fallback = await fetch(`/api/wallet-metadata?action=history&subaction=resolve&q=${encodeURIComponent(idLower)}`);
              if (fallback.ok) {
                const data = await fallback.json().catch(() => ({}));
                const candidate = data?.walletAddress || data?.railgunAddress || data?.address || data?.result || null;
                if (candidate && String(candidate).startsWith('0zk')) {
                  resolved = candidate;
                }
              }
            } catch {}
          }
          if (!resolved || !String(resolved).startsWith('0zk')) {
            throw new Error('Lexie ID not found');
          }
          setRecipientLexieId(idLower);
          setResolvedRecipientAddress(resolved);
        } else {
          throw new Error('Invalid recipient format');
        }
      } catch (e) {
        setRecipientResolveError(e?.message || 'Failed to resolve recipient');
      }
    };
    resolveRecipient();
  }, [toParam]);

  // Validate payment link parameters without flashing an error while resolving
  const lexieIdPattern = /^[a-zA-Z0-9_]{3,20}$/;
  const isCandidateToParam = Boolean(toParam && (toParam.startsWith('0zk') || lexieIdPattern.test(toParam)));
  const isValidPaymentLink = isCandidateToParam && !recipientResolveError;

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Background overlays (match other pages) */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-6 sm:px-8 lg:px-12 py-12">
        <TerminalWindow
          title="lexie-pay"
          statusLabel={isConnected ? "CONNECTED" : "WAITING"}
          statusTone={isConnected ? "online" : "waiting"}
          footerLeft={<span>Process: payment</span>}
          footerRight={isConnected ? "Active" : "Initializing"}
          variant="vault"
        >
          <div className="p-8 font-mono text-green-300">
            <div className="text-center mb-6">
              <ShieldCheckIcon className="h-16 w-16 text-emerald-300 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-emerald-300 mb-2">Fund Vault</h1>
              <p className="text-green-400/80 text-sm">
                Send tokens to this vault
              </p>
            </div>

            {/* Recipient Info / Validation */}
            <div className="bg-black/40 border border-green-500/20 rounded p-3 mb-6">
              {/* Labels row */}
              <div className="grid grid-cols-2 items-center px-3 text-center">
                <div className="text-green-400/80 text-xs">Recipient:</div>
                <div className="text-green-400/80 text-xs">Network:</div>
              </div>
              {/* Values row */}
              <div className="mt-1 grid grid-cols-2 items-center px-3 text-center">
                <div className="text-green-200 text-sm font-mono break-all">
                  {recipientLexieId ? `@${recipientLexieId}` : (resolvedRecipientAddress || 'Resolving…')}
                </div>
                <div className="text-green-200 text-sm font-mono">
                  {networks[targetChainId]?.name || `Chain ${targetChainId}`}
                </div>
              </div>
              {!recipientLexieId && !recipientResolveError && (
                <div className="text-green-300 text-xs mt-2">
                  They didn’t claim a Lexie ID yet — might as well be faxing ETH.
                </div>
              )}
              {recipientResolveError && (
                <div className="text-red-300 text-xs mt-2">
                  {recipientResolveError}
                </div>
              )}
            </div>

            {!isConnected ? (
              /* Connect Wallet Section */
              <div className="space-y-4">
                <div className="text-center text-green-400/80 text-sm mb-4">
                  Connect your wallet to continue
                </div>
                <InjectedProviderButtons disabled={false} />
                <div className="mt-6 text-sm text-green-400/70 text-center">
                  <p>Choose your preferred wallet to connect</p>
                  <p className="mt-1 pb-3 text-xs">Connection is zk-secured and encrypted</p>
                </div>
              </div>
            ) : !isCorrectNetwork ? (
              /* Wrong Network Section */
              <div className="space-y-4">
                <div className="bg-yellow-900/20 border border-yellow-500/40 rounded p-3">
                  <div className="text-yellow-300 text-sm">
                    ⚠️ Wrong Network
                  </div>
                  <div className="text-yellow-200/80 text-xs mt-1">
                    Please switch to {networks[targetChainId]?.name || `Chain ${targetChainId}`}
                  </div>
                </div>
                <button
                  onClick={handleNetworkSwitch}
                  className="w-full bg-yellow-600/30 hover:bg-yellow-600/50 text-yellow-200 py-3 px-6 rounded font-medium transition-colors border border-yellow-400/40"
                >
                  Switch to {networks[targetChainId]?.name || 'Correct Network'}
                </button>
              </div>
            ) : (
              /* Payment Form */
              <form onSubmit={handlePayment} className="space-y-4">
                {/* Token Selection */}
                <div>
                  <label className="block text-sm font-medium text-green-300 mb-2">
                    Token
                  </label>
                  <div className="relative" ref={tokenMenuRef}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isLoadingBalances && publicBalances.length > 0) setIsTokenMenuOpen((v) => !v);
                      }}
                      disabled={isLoadingBalances || publicBalances.length === 0}
                      className={`w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200 flex items-center justify-between ${
                        isLoadingBalances || publicBalances.length === 0 ? 'cursor-not-allowed opacity-60' : 'hover:bg-green-900/20'
                      }`}
                    >
                      <span>
                        {selectedToken
                          ? `${selectedToken.symbol} - ${formatBalance(selectedToken.numericBalance)} available${selectedToken.balanceUSD !== undefined ? ` ($${typeof selectedToken.balanceUSD === 'string' && selectedToken.balanceUSD.startsWith('$') ? selectedToken.balanceUSD.substring(1) : selectedToken.balanceUSD})` : ''}`
                          : isLoadingBalances
                            ? 'Loading tokens...'
                            : 'Select token'}
                      </span>
                      <span className="ml-2">▾</span>
                    </button>
                    {isTokenMenuOpen && (
                      <div className="absolute z-20 mt-1 left-0 right-0 bg-black text-green-300 border border-green-500/40 rounded shadow-xl max-h-60 overflow-auto">
                        {publicBalances.map((token) => (
                          <button
                            key={token.address || 'native'}
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
                      {selectedToken.balanceUSD !== undefined && (
                        <span className="ml-2">
                          (${typeof selectedToken.balanceUSD === 'string' && selectedToken.balanceUSD.startsWith('$') ? selectedToken.balanceUSD.substring(1) : selectedToken.balanceUSD})
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={!selectedToken || !amount || parseFloat(amount) <= 0 || isProcessing || !resolvedRecipientAddress || !!recipientResolveError}
                  className={`w-full py-3 px-4 rounded font-medium transition-colors flex items-center justify-center gap-2 ${
                    selectedToken && amount && parseFloat(amount) > 0 && !isProcessing && resolvedRecipientAddress && !recipientResolveError
                      ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-400/40'
                      : 'bg-black/40 text-green-400/50 border border-green-500/20 cursor-not-allowed'
                  }`}
                >
                  {isProcessing ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-400"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <ArrowDownIcon className="h-4 w-4" />
                      Fund Vault
                    </>
                  )}
                </button>
              </form>
            )}

            {/* Disconnect Option */}
            {isConnected && (
              <div className="mt-4 p-3 bg-black/60 border border-green-500/20 rounded">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="h-5 w-5 mr-3 bg-red-500/20 rounded flex items-center justify-center">
                      <span className="text-red-400 text-xs">⚠️</span>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-green-300">Switch wallets?</h4>
                      <p className="text-xs text-green-400/70">Disconnect to choose a different wallet</p>
                    </div>
                  </div>
                  <button
                    onClick={disconnectWallet}
                    className="px-3 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-200 text-xs rounded border border-red-400/40 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}

            {/* Info */}
            <div className="mt-4 p-4 bg-black/60 border border-green-500/20 rounded">
              <div className="flex">
                <ShieldCheckIcon className="h-5 w-5 text-emerald-300 flex-shrink-0 mt-0.5" />
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-emerald-300">Secure Transaction</h4>
                  <p className="mt-1 text-sm text-green-300/80">
                    Funds will be deposited into this recipient's vault.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TerminalWindow>
      </div>

    </div>
  );
};

export default PaymentPage;
