/**
 * Payment Page - External users can fund a vault via payment link
 * Integrates shieldTransactions.js with Chainalysis screening
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { 
  WalletIcon, 
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ArrowDownIcon,
} from '@heroicons/react/24/outline';

import { useWallet } from '../contexts/WalletContext';
import { shieldTokens } from '../utils/railgun/shieldTransactions';
import { assertNotSanctioned } from '../utils/sanctions/chainalysis-oracle';
import { isTokenSupportedByRailgun } from '../utils/railgun/actions';

const PaymentPage = () => {
  const [searchParams] = useSearchParams();
  const recipientVaultAddress = searchParams.get('to');
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
  } = useWallet();

  const [selectedToken, setSelectedToken] = useState(null);
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [publicBalances, setPublicBalances] = useState([]);
  const [isLoadingBalances, setIsLoadingBalances] = useState(false);

  // Parse target chain ID
  const targetChainId = chainIdParam ? parseInt(chainIdParam) : 1;

  // Network configurations
  const networks = {
    1: { name: 'Ethereum', symbol: 'ETH' },
    137: { name: 'Polygon', symbol: 'MATIC' },
    42161: { name: 'Arbitrum', symbol: 'ETH' },
    56: { name: 'BNB Chain', symbol: 'BNB' },
  };

  // Validate payment link parameters
  const isValidPaymentLink = recipientVaultAddress && recipientVaultAddress.startsWith('0zk');

  // Check if user is on correct network
  const isCorrectNetwork = chainId === targetChainId;

  // Fetch public balances when connected and on correct network
  useEffect(() => {
    if (!isConnected || !address || !isCorrectNetwork) {
      setPublicBalances([]);
      return;
    }

    const fetchBalances = async () => {
      setIsLoadingBalances(true);
      try {
        // Use ethers to get balances directly
        const provider = await walletProvider();
        const providerInstance = provider.provider;
        
        // Common tokens per chain
        const commonTokens = {
          1: [ // Ethereum
            { symbol: 'ETH', address: null, name: 'Ethereum', decimals: 18 },
            { symbol: 'USDC', address: '0xA0b86a33E6441c0086ec7a4dC2c7c37C1A5e01b4', name: 'USD Coin', decimals: 6 },
            { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: 'Tether USD', decimals: 6 },
          ],
          137: [ // Polygon
            { symbol: 'MATIC', address: null, name: 'Polygon', decimals: 18 },
            { symbol: 'USDC', address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', name: 'USD Coin', decimals: 6 },
          ],
          42161: [ // Arbitrum
            { symbol: 'ETH', address: null, name: 'Ethereum', decimals: 18 },
            { symbol: 'USDC', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', name: 'USD Coin', decimals: 6 },
          ],
          56: [ // BNB Chain
            { symbol: 'BNB', address: null, name: 'BNB', decimals: 18 },
            { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', name: 'Tether USD', decimals: 18 },
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
                // ERC20 token - simplified check
                balance = '0'; // For now, just show 0 for ERC20s to avoid complexity
              }
              
              const numericBalance = parseFloat(balance) / Math.pow(10, token.decimals);
              return {
                ...token,
                numericBalance: Number(numericBalance.toFixed(6)),
              };
            } catch (error) {
              console.warn(`Failed to get balance for ${token.symbol}:`, error);
              return {
                ...token,
                numericBalance: 0,
              };
            }
          })
        );

        setPublicBalances(balancesWithData.filter(token => 
          isTokenSupportedByRailgun(token.address, chainId)
        ));
      } catch (error) {
        console.error('Failed to fetch balances:', error);
        // Fallback to basic token structure
        setPublicBalances([
          { 
            symbol: networks[chainId]?.symbol || 'ETH', 
            address: null, 
            name: networks[chainId]?.name || 'Ethereum',
            numericBalance: 0,
            decimals: 18,
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

  // Handle payment processing
  const handlePayment = async (e) => {
    e.preventDefault();
    
    if (!selectedToken || !amount || parseFloat(amount) <= 0) {
      toast.error('Please select a token and enter a valid amount');
      return;
    }

    if (!isConnected || !address) {
      toast.error('Please connect your wallet first');
      return;
    }

    if (!isCorrectNetwork) {
      toast.error(`Please switch to ${networks[targetChainId]?.name || 'the correct network'}`);
      return;
    }

    setIsProcessing(true);

    try {
      // Sanctions screening for the payer (current user)
      console.log('[PaymentPage] Screening payer wallet:', address);
      await assertNotSanctioned(chainId, address);
      console.log('[PaymentPage] Payer screening passed');

      // Check if token is supported by Railgun
      if (!isTokenSupportedByRailgun(selectedToken.address, chainId)) {
        throw new Error(`${selectedToken.symbol} is not supported on this network`);
      }

      // Check sufficient balance
      const requestedAmount = parseFloat(amount);
      if (selectedToken.numericBalance < requestedAmount) {
        throw new Error(`Insufficient balance. Available: ${selectedToken.numericBalance} ${selectedToken.symbol}`);
      }

      // Convert amount to token units
      const amountInUnits = (BigInt(Math.floor(requestedAmount * Math.pow(10, selectedToken.decimals)))).toString();

      // Prepare shield transaction
      const chainConfig = { 
        type: networks[chainId]?.name?.toLowerCase() || 'ethereum', 
        id: chainId 
      };

      console.log('[PaymentPage] Initiating shield transaction to vault:', {
        recipientVault: recipientVaultAddress,
        token: selectedToken.symbol,
        amount: requestedAmount,
        chainId
      });

      // Execute shield operation
      const result = await shieldTokens({
        tokenAddress: selectedToken.address,
        amount: amountInUnits,
        chain: chainConfig,
        fromAddress: address,
        railgunAddress: recipientVaultAddress, // This is the recipient's vault
        walletProvider: await walletProvider()
      });

      // Send transaction
      const walletSigner = await walletProvider();
      const txResponse = await walletSigner.sendTransaction(result.transaction);

      toast.success(
        `Payment sent! Shielding ${amount} ${selectedToken.symbol} to recipient's vault. TX: ${txResponse.hash}`,
        { duration: 6000 }
      );

      // Reset form
      setAmount('');
      
    } catch (error) {
      console.error('[PaymentPage] Payment failed:', error);
      
      if (error.message.includes('sanctions') || error.message.includes('sanctioned')) {
        toast.error('Transaction blocked: Address appears on sanctions list');
      } else if (error.code === 4001 || /rejected/i.test(error?.message || '')) {
        toast.error('Transaction cancelled by user');
      } else {
        toast.error(`Payment failed: ${error.message}`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle network switch
  const handleNetworkSwitch = async () => {
    try {
      await switchNetwork(targetChainId);
      toast.success(`Switched to ${networks[targetChainId]?.name || 'target network'}`);
    } catch (error) {
      toast.error(`Failed to switch network: ${error.message}`);
    }
  };

  if (!isValidPaymentLink) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <ExclamationTriangleIcon className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-red-300 mb-2">Invalid Payment Link</h1>
          <p className="text-gray-400">The payment link is malformed or missing required parameters.</p>
        </div>
      </div>
    );
  }

  // Try to resolve recipient Lexie ID from their vault address (same approach as WalletPage)
  const [recipientLexieId, setRecipientLexieId] = useState(null);
  useEffect(() => {
    const resolveLexie = async () => {
      try {
        if (!recipientVaultAddress) return;
        const resp = await fetch(`/api/wallet-metadata?action=by-wallet&railgunAddress=${encodeURIComponent(recipientVaultAddress)}`);
        if (!resp.ok) { setRecipientLexieId(null); return; }
        const json = await resp.json().catch(() => ({}));
        if (json.success && json.lexieID) {
          setRecipientLexieId(json.lexieID);
        } else {
          setRecipientLexieId(null);
        }
      } catch (e) {
        console.warn('[PaymentPage] Failed to resolve Lexie ID for recipient:', e?.message);
        setRecipientLexieId(null);
      }
    };
    resolveLexie();
  }, [recipientVaultAddress]);

  return (
    <div className="relative min-h-screen w-full bg-black text-white overflow-x-hidden">
      {/* Background overlays (match other pages) */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-gradient-to-br from-black via-purple-900/30 to-blue-900/20"></div>
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/60"></div>
        <div className="absolute bottom-0 left-0 right-0 h-1/3 bg-gradient-to-t from-purple-900/40 via-purple-800/20 to-transparent"></div>
      </div>

      <div className="relative z-10 max-w-md mx-auto px-4 py-12">
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
              <span className="text-sm tracking-wide text-green-200 font-mono">lexie-pay</span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              {isConnected && address ? (
                <>
                  <span className="text-green-400/80 hidden sm:inline">{address.slice(0,6)}...{address.slice(-4)}</span>
                  <button
                    onClick={disconnectWallet}
                    className="bg-black hover:bg-red-900/30 text-red-300 px-2 py-1 rounded border border-red-500/40"
                  >
                    Disconnect
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* Terminal content */}
          <div className="p-8 font-mono text-green-300">
            <div className="text-center mb-6">
              <ShieldCheckIcon className="h-16 w-16 text-emerald-300 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-emerald-300 mb-2">Fund Vault</h1>
              <p className="text-green-400/80 text-sm">
                Send tokens to this vault
              </p>
            </div>

            {/* Recipient Info */}
            <div className="bg-black/40 border border-green-500/20 rounded p-3 mb-6">
              {/* Labels row */}
              <div className="flex items-center justify-between">
                <div className="text-green-400/80 text-xs">Recipient:</div>
                <div className="text-green-400/80 text-xs">Network:</div>
              </div>
              {/* Values row */}
              <div className="mt-1 flex items-center justify-between">
                <div className="text-green-200 text-sm font-mono break-all">
                  {recipientLexieId ? `@${recipientLexieId}` : '—'}
                </div>
                <div className="text-green-200 text-sm font-mono">
                  {networks[targetChainId]?.name || `Chain ${targetChainId}`}
                </div>
              </div>
              {!recipientLexieId && (
                <div className="text-green-300 text-xs mt-2">
                  They didn’t claim a Lexie ID yet — might as well be faxing ETH.
                </div>
              )}
            </div>

            {!isConnected ? (
              /* Connect Wallet Section */
              <div className="space-y-4">
                <div className="text-center text-green-400/80 text-sm mb-4">
                  Connect your wallet to continue
                </div>
                <button
                  onClick={() => connectWallet('metamask')}
                  className="w-full bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 py-3 px-6 rounded font-medium transition-colors flex items-center justify-center space-x-2 border border-emerald-400/40"
                >
                  <span>🦊</span>
                  <span>Connect MetaMask</span>
                </button>
                <button
                  onClick={() => connectWallet('walletconnect')}
                  className="w-full bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 py-3 px-6 rounded font-medium transition-colors flex items-center justify-center space-x-2 border border-emerald-400/40"
                >
                  <span>🔗</span>
                  <span>WalletConnect</span>
                </button>
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
                  <select
                    value={selectedToken?.address || ''}
                    onChange={(e) => {
                      const token = publicBalances.find(t => (t.address || '') === e.target.value);
                      setSelectedToken(token || null);
                    }}
                    className="w-full px-3 py-2 border border-green-500/40 rounded bg-black text-green-200"
                    disabled={isLoadingBalances || publicBalances.length === 0}
                  >
                    {isLoadingBalances ? (
                      <option value="">Loading tokens...</option>
                    ) : publicBalances.length === 0 ? (
                      <option value="">No tokens available</option>
                    ) : (
                      publicBalances.map((token) => (
                        <option key={token.address || 'native'} value={token.address || ''}>
                          {token.symbol} - {token.numericBalance} available
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
                      Available: {selectedToken.numericBalance} {selectedToken.symbol}
                    </p>
                  )}
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={!selectedToken || !amount || parseFloat(amount) <= 0 || isProcessing}
                  className={`w-full py-3 px-4 rounded font-medium transition-colors flex items-center justify-center gap-2 ${
                    selectedToken && amount && parseFloat(amount) > 0 && !isProcessing
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

            {/* Info */}
            <div className="mt-6 p-4 bg-black/60 border border-green-500/20 rounded">
              <div className="flex">
                <ShieldCheckIcon className="h-5 w-5 text-emerald-300 flex-shrink-0 mt-0.5" />
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-emerald-300">Secure Transaction</h4>
                  <p className="mt-1 text-sm text-green-300/80">
                    Funds will be deposited into the recipient's vault.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Terminal footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-green-500/20 bg-black/90 text-xs font-mono">
            <div className="flex items-center gap-4 text-green-300/80">
              <span>Process: payment</span>
              <span>•</span>
              <span>Status: {isConnected ? 'Connected' : 'Waiting'}</span>
            </div>
            <span className="text-green-300/80">•</span>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400">ONLINE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentPage;
