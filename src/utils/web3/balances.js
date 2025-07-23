/**
 * Web3 Balances Utilities
 * Provides compatibility functions for components still using web3 balance checks
 * NOTE: This module is deprecated. Components should use the useBalances hook directly for real-time balance data instead of these legacy functions.
 */

/**
 * Check if user has sufficient balance for a transaction
 * @param {string} address - User address  
 * @param {string} tokenAddress - Token address
 * @param {string} amount - Amount to check
 * @param {number} chainId - Chain ID
 * @param {Array} balances - Required: provide balances directly from useBalances hook
 * @returns {Object} Balance check result with hasSufficient and available properties
 */
export const checkSufficientBalance = async (address, tokenAddress, amount, chainId, balances = null) => {
  try {
    console.warn('[Web3Balances] checkSufficientBalance called - this function is deprecated. Use useBalances hook instead.');
    console.log('[Web3Balances] Checking balance for:', {
      address: address?.slice(0, 8) + '...',
      tokenAddress: tokenAddress?.slice(0, 8) + '...',
      amount,
      chainId
    });
    
    let allBalances = balances;
    
    // Fallback to deprecated global state only if no balances provided
    if (!allBalances) {
      allBalances = window.__LEXIE_BALANCES__ || [];
      console.warn('[Web3Balances] Using deprecated global state - components should pass balances directly from useBalances hook');
    }
    
    // Find the token balance
    let tokenBalance = null;
    
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Native token - try both public and private
      tokenBalance = allBalances.find(b => 
        !b.tokenAddress && 
        (b.symbol === 'ETH' || b.symbol === 'MATIC' || b.symbol === 'BNB')
      );
    } else {
      // ERC20 token - try both public and private  
      tokenBalance = allBalances.find(b => 
        b.tokenAddress && 
        b.tokenAddress.toLowerCase() === tokenAddress.toLowerCase()
      );
    }
    
    if (!tokenBalance) {
      console.log('[Web3Balances] Token not found in balances');
      return {
        hasSufficient: false,
        available: '0'
      };
    }
    
    const requestedAmount = parseFloat(amount);
    const availableAmount = tokenBalance.numericBalance || 0;
    
    console.log('[Web3Balances] Balance check result:', {
      symbol: tokenBalance.symbol,
      available: availableAmount,
      requested: requestedAmount,
      sufficient: availableAmount >= requestedAmount,
      isPrivate: tokenBalance.isPrivate
    });
    
    return {
      hasSufficient: availableAmount >= requestedAmount,
      available: availableAmount.toString()
    };
    
  } catch (error) {
    console.error('[Web3Balances] Balance check failed:', error);
    return {
      hasSufficient: false,
      available: '0'
    };
  }
};

export default {
  checkSufficientBalance,
}; 