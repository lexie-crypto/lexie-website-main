/**
 * RAILGUN Wallet Uniqueness Test Utility
 * 
 * This script helps verify that each user gets their own unique RAILGUN wallet
 * and that there are no privacy leaks between users.
 */

/**
 * Test wallet uniqueness by simulating multiple users
 * This should be run in the browser console for testing
 */
export const testWalletUniqueness = async () => {
  console.log('🧪 Testing RAILGUN Wallet Uniqueness...');
  
  // Simulate different user addresses for testing
  const testUsers = [
    '0x1234567890123456789012345678901234567890',
    '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    '0x9876543210987654321098765432109876543210'
  ];
  
  const results = [];
  
  for (const userAddress of testUsers) {
    console.log(`\n👤 Testing user: ${userAddress}`);
    
    // Check storage keys for this user
    const userStorageKey = `railgun-walletID-${userAddress.toLowerCase()}`;
    const userMnemonicKey = `railgun-mnemonic-${userAddress.toLowerCase()}`;
    
    const storedWalletID = localStorage.getItem(userStorageKey);
    const storedMnemonic = localStorage.getItem(userMnemonicKey);
    
    results.push({
      userAddress,
      walletID: storedWalletID?.slice(0, 8) + '...' || 'Not created',
      hasMnemonic: !!storedMnemonic,
      storageKeys: {
        wallet: userStorageKey,
        mnemonic: userMnemonicKey
      }
    });
    
    console.log(`  💾 Wallet ID: ${storedWalletID?.slice(0, 8) + '...' || 'Not created'}`);
    console.log(`  🔑 Has Mnemonic: ${!!storedMnemonic}`);
  }
  
  // Check for uniqueness
  const walletIDs = results
    .map(r => r.walletID)
    .filter(id => id !== 'Not created');
  
  const uniqueWalletIDs = new Set(walletIDs);
  
  console.log('\n📊 Test Results:');
  console.log('Total users tested:', results.length);
  console.log('Wallets created:', walletIDs.length);
  console.log('Unique wallet IDs:', uniqueWalletIDs.size);
  console.log('Is unique per user:', walletIDs.length === uniqueWalletIDs.size);
  
  if (walletIDs.length === uniqueWalletIDs.size) {
    console.log('✅ SUCCESS: All users have unique RAILGUN wallets');
  } else {
    console.error('❌ FAILURE: Some users share the same RAILGUN wallet!');
    console.error('This is a critical privacy bug!');
  }
  
  return {
    isUnique: walletIDs.length === uniqueWalletIDs.size,
    results,
    summary: {
      totalUsers: results.length,
      walletsCreated: walletIDs.length,
      uniqueWallets: uniqueWalletIDs.size
    }
  };
};

/**
 * Clear test data for a specific user
 */
export const clearTestUserData = (userAddress) => {
  const userStorageKey = `railgun-walletID-${userAddress.toLowerCase()}`;
  const userMnemonicKey = `railgun-mnemonic-${userAddress.toLowerCase()}`;
  
  localStorage.removeItem(userStorageKey);
  localStorage.removeItem(userMnemonicKey);
  
  console.log(`🗑️ Cleared test data for user: ${userAddress}`);
};

/**
 * Simulate signature generation for testing
 * In real usage, this comes from the user's wallet
 */
export const simulateSignature = (address) => {
  // Generate a unique signature-like string for testing
  const timestamp = Date.now();
  const entropy = Math.random().toString(36).substring(2);
  return `0x${address.slice(2)}${timestamp.toString(16)}${entropy}`.slice(0, 132);
};

// Expose to window for easy testing
if (typeof window !== 'undefined') {
  window.__LEXIE_TEST__ = {
    testWalletUniqueness,
    clearTestUserData,
    simulateSignature
  };
  
  console.log('🧪 RAILGUN Wallet Uniqueness Test utilities loaded:');
  console.log('- window.__LEXIE_TEST__.testWalletUniqueness()');
  console.log('- window.__LEXIE_TEST__.clearTestUserData(address)');
  console.log('- window.__LEXIE_TEST__.simulateSignature(address)');
} 