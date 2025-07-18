/**
 * Web3 Balances Utilities
 * Provides compatibility functions for components still using web3 balance checks
 */

/**
 * Check if user has sufficient balance for a transaction
 * @param {string} address - User address
 * @param {string} tokenAddress - Token address
 * @param {string} amount - Amount to check
 * @param {number} chainId - Chain ID
 * @returns {Object} Balance check result with hasSufficient and available properties
 */
export const checkSufficientBalance = async (address, tokenAddress, amount, chainId) => {
  try {
    console.log('[Web3Balances] checkSufficientBalance called - using real balance check');
    
    // Get balances from global state (this is a simplified approach)
    // In practice, we'd need to pass balances or fetch them here
    const balances = window.__LEXIE_BALANCES__ || [];
    
    // Find the token balance
    let tokenBalance = null;
    
    if (!tokenAddress || tokenAddress === '0x0000000000000000000000000000000000000000') {
      // Native token
      tokenBalance = balances.find(b => !b.address && (b.symbol === 'ETH' || b.symbol === 'MATIC' || b.symbol === 'BNB'));
    } else {
      // ERC20 token
      tokenBalance = balances.find(b => b.address && b.address.toLowerCase() === tokenAddress.toLowerCase());
    }
    
    if (!tokenBalance) {
      return {
        hasSufficient: false,
        available: '0'
      };
    }
    
    const requestedAmount = parseFloat(amount);
    const availableAmount = tokenBalance.numericBalance || 0;
    
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