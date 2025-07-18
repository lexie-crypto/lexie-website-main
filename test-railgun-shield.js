/**
 * Railgun Unshield Test Script - SIMPLIFIED
 * ==========================================
 * Minimal test to debug the "Cannot read properties of undefined (reading 'chain')" error
 * 
 * This script tests ONLY the gasEstimateForUnprovenUnshield function with proper feeTokenDetails
 * to isolate the chain property issue.
 */

import { 
  gasEstimateForUnprovenUnshield,
  startRailgunEngine,
  loadProvider,
  getProver,
  setLoggers,
} from '@railgun-community/wallet';

import { NetworkName } from '@railgun-community/shared-models';
import { groth16 } from 'snarkjs';

// ===========================
// TEST CONFIGURATION
// ===========================
const TEST_CONFIG = {
  // Arbitrum network
  CHAIN_ID: 42161,
  NETWORK_NAME: NetworkName.Arbitrum,
  
  // USDT on Arbitrum
  USDT_ADDRESS: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  USDT_DECIMALS: 6,
  
  // Test amounts (1 USDT = 1,000,000 units with 6 decimals)
  TRANSFER_AMOUNT: '1000000', // 1 USDT
  
  // Fee configuration (1%)
  FEE_BPS: 100n, // 1% in basis points
  FEE_RECEIVER: '0x108eA687844AB79223E5D5F49ecDf69f2E93B453',
  
  // Test addresses
  FROM_RAILGUN_ADDRESS: '0zk1qy2taa7t3mrefw22zkcm9u2fxr2ptar33ey9e5nhdd9n8v7lf9l7frv7j6fe3z53ll5myqmargu2knguprm6tafpp7erhdnedec3p0df56mlf2cp5k34grvncm4', // Railgun address (sender)
  TO_EOA_ADDRESS: '0x5EE83Dde15f9D08Ec7e7db30b9bd748EB8f6307B', // EOA address (recipient)
  
  // Test wallet data
  RAILGUN_WALLET_ID: 'test-wallet-id-12345',
  ENCRYPTION_KEY: Uint8Array.from([
    0x17, 0xa9, 0x5b, 0xee, 0x3c, 0x19, 0x84, 0xab,
    0xe7, 0x29, 0x03, 0xcf, 0x66, 0x1d, 0x70, 0x42,
    0x91, 0xfd, 0x58, 0xbb, 0xa1, 0x2f, 0x90, 0x1a,
    0x4e, 0xd0, 0x3b, 0x7c, 0x68, 0x0a, 0x35, 0x99
  ]),
};

// ===========================
// RAILGUN INITIALIZATION
// ===========================

/**
 * Mock database for Node.js testing (since LevelJS requires browser IndexedDB)
 */
class MockDatabase {
  constructor() {
    this.data = new Map();
    this.isOpen = false;
  }
  
  async open() {
    this.isOpen = true;
    return this;
  }
  
  async put(key, value) {
    this.data.set(key, value);
  }
  
  async get(key) {
    if (!this.data.has(key)) {
      throw new Error(`Key not found: ${key}`);
    }
    return this.data.get(key);
  }
  
  async del(key) {
    this.data.delete(key);
  }
  
  async close() {
    this.isOpen = false;
  }
  
  // Additional methods that might be needed
  createReadStream() {
    return {
      on: () => {},
      end: () => {}
    };
  }
  
  createKeyStream() {
    return {
      on: () => {},
      end: () => {}
    };
  }
  
  batch() {
    return {
      put: async () => {},
      del: async () => {},
      write: async () => {}
    };
  }
}

/**
 * Initialize Railgun engine for testing
 */
async function initializeRailgunEngine() {
  console.log('🔧 Initializing Railgun engine...');
  
  try {
    // Create mock database instance for Node.js
    const db = new MockDatabase();
    
    // Set up logging
    setLoggers(
      (message) => console.log(`[Railgun] ${message}`),
      (error) => console.error(`[Railgun] ${error}`)
    );
    
    // Minimal artifact store for testing
    const artifactStore = {
      getFile: async () => null,
      storeFile: async () => {},
      fileExists: async () => false,
    };
    
    // Start the engine with minimal configuration
    await startRailgunEngine(
      'lexietest',             // walletSource (alphanumeric, <16 chars)
      db,                      // db
      true,                    // shouldDebug
      artifactStore,           // artifactStore
      false,                   // useNativeArtifacts
      true,                    // skipMerkletreeScans (true for testing)
      [],                      // poiNodeUrls (empty for testing)
      [],                      // customPOILists (empty for testing)
      false                    // verboseScanLogging
    );
    
    console.log('✅ Railgun engine initialized');
    
    // Load ZK prover
    console.log('🔧 Loading snarkJS Groth16 prover...');
    getProver().setSnarkJSGroth16(groth16);
    console.log('✅ snarkJS Groth16 prover loaded');
    
    // Skip provider loading for simplified test
    console.log('⚠️ Skipping provider loading - testing feeTokenDetails structure only');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Railgun engine:', error);
    throw error;
  }
}

/**
 * Load Arbitrum network provider for testing
 */
async function loadArbitrumProvider() {
  console.log('🔧 Loading Arbitrum provider...');
  
  try {
    const providerConfig = {
      chainId: TEST_CONFIG.CHAIN_ID,
      providers: [
        {
          provider: 'https://rpc.ankr.com/arbitrum/e7886d2b9a773c6bd849e717a32896521010a7782379a434977c1ce07752a9a7',
          priority: 1,
          weight: 1,
        },
      ],
    };
    
    const { feesSerialized } = await loadProvider(
      providerConfig,
      TEST_CONFIG.NETWORK_NAME,
      5 * 60 * 1000 // 5 minute polling interval
    );
    
    console.log('✅ Arbitrum provider loaded with fees:', feesSerialized);
    return feesSerialized;
  } catch (error) {
    console.error('❌ Failed to load Arbitrum provider:', error);
    throw error;
  }
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Create a mock ERC20AmountRecipient (simplified version)
 */
function createERC20AmountRecipient(tokenAddress, amount, recipientAddress) {
  return {
    tokenAddress: tokenAddress || undefined,
    amount: amount.toString(),
    recipientAddress: recipientAddress,
  };
}

/**
 * Calculate fee amount
 */
function calculateFeeAmount(transferAmount) {
  const amount = BigInt(transferAmount);
  const feeAmount = (amount * TEST_CONFIG.FEE_BPS) / 10000n;
  
  console.log('💵 Fee calculation:', {
    transferAmount: transferAmount,
    feeBps: TEST_CONFIG.FEE_BPS.toString(),
    feeAmount: feeAmount.toString(),
    feePercentage: '1%'
  });
  
  return feeAmount;
}

/**
 * Create feeTokenDetails object with v10.4.x structure
 */
function createFeeTokenDetails(feeAmount) {
  const feeTokenDetails = {
    tokenAddress: TEST_CONFIG.USDT_ADDRESS,
    feeAmount, // Calculated 1% fee
    feePerUnitGas: 0n, // Not using relayer
    feeReceiverAddress: TEST_CONFIG.FEE_RECEIVER,
    chainId: TEST_CONFIG.CHAIN_ID, // CRITICAL: SDK uses this to derive chain
    decimals: TEST_CONFIG.USDT_DECIMALS,
    symbol: 'USDT',
  };
  
  console.log('🏷️ Created feeTokenDetails:', {
    tokenAddress: feeTokenDetails.tokenAddress,
    feeAmount: feeTokenDetails.feeAmount.toString(),
    feeReceiverAddress: feeTokenDetails.feeReceiverAddress,
    chainId: feeTokenDetails.chainId,
    symbol: feeTokenDetails.symbol,
    decimals: feeTokenDetails.decimals
  });
  
  return feeTokenDetails;
}

/**
 * Simple test of gasEstimateForUnprovenUnshield with feeTokenDetails
 */
async function testGasEstimation() {
  console.log('\n⛽ Testing gasEstimateForUnprovenUnshield with feeTokenDetails...');
  
  try {
    // Calculate fee
    const feeAmount = calculateFeeAmount(TEST_CONFIG.TRANSFER_AMOUNT);
    const feeTokenDetails = createFeeTokenDetails(feeAmount);
    
    // Create ERC20 amount recipient (EOA address for unshield)
    const erc20AmountRecipient = createERC20AmountRecipient(
      TEST_CONFIG.USDT_ADDRESS,
      TEST_CONFIG.TRANSFER_AMOUNT,
      TEST_CONFIG.TO_EOA_ADDRESS
    );
    
    console.log('📦 Created ERC20 amount recipient:', erc20AmountRecipient);
    
    const erc20AmountRecipients = [erc20AmountRecipient];
    const nftAmountRecipients = []; // No NFTs for this test
    
    // Log all parameters before SDK call
    console.log('📋 gasEstimateForUnprovenUnshield parameters:', {
      networkName: TEST_CONFIG.NETWORK_NAME,
      railgunWalletID: TEST_CONFIG.RAILGUN_WALLET_ID,
      encryptionKey: `Uint8Array(${TEST_CONFIG.ENCRYPTION_KEY.length}) - ***hidden***`,
      erc20AmountRecipientsLength: erc20AmountRecipients.length,
      nftAmountRecipientsLength: nftAmountRecipients.length,
      fromRailgunAddress: TEST_CONFIG.FROM_RAILGUN_ADDRESS,
      feeTokenDetails: {
        tokenAddress: feeTokenDetails.tokenAddress,
        feeAmount: feeTokenDetails.feeAmount.toString(),
        feeReceiverAddress: feeTokenDetails.feeReceiverAddress,
        chainId: feeTokenDetails.chainId,
        symbol: feeTokenDetails.symbol,
        hasFeeAmount: 'feeAmount' in feeTokenDetails,
        hasFeeReceiver: 'feeReceiverAddress' in feeTokenDetails,
        hasChainId: 'chainId' in feeTokenDetails
      }
    });
    
    // Call gasEstimateForUnprovenUnshield with v10.4.x compliant parameters
    console.log('🔍 Calling gasEstimateForUnprovenUnshield...');
    
    const gasDetails = await gasEstimateForUnprovenUnshield(
      TEST_CONFIG.NETWORK_NAME,
      TEST_CONFIG.RAILGUN_WALLET_ID,
      TEST_CONFIG.ENCRYPTION_KEY,
      erc20AmountRecipients,
      nftAmountRecipients,
      feeTokenDetails // V10.4.x required parameter - should prevent 'chain' error
    );
    
    console.log('✅ Gas estimation successful:', gasDetails);
    return gasDetails;
    
  } catch (error) {
    console.error('❌ Gas estimation failed:', {
      errorType: error.constructor.name,
      errorMessage: error.message,
      errorStack: error.stack
    });
    
    // Check if this is the specific chain property error we're debugging
    if (error.message.includes("Cannot read properties of undefined (reading 'chain')")) {
      console.error('🔥 FOUND THE CHAIN PROPERTY ERROR!');
      console.error('This confirms the feeTokenDetails structure is still incorrect');
    }
    
    throw error;
  }
}

/**
 * Main test function - simplified to test gasEstimateForUnprovenUnshield only
 */
async function runUnshieldTest() {
  console.log('🧪 RAILGUN UNSHIELD TEST SCRIPT - SIMPLIFIED');
  console.log('==========================================\n');
  console.log('Testing ONLY gasEstimateForUnprovenUnshield with proper feeTokenDetails');
  console.log('Sending from Railgun address to EOA address');
  console.log('Goal: Reproduce/fix the "Cannot read properties of undefined (reading \'chain\')" error\n');
  
  try {
    // Initialize Railgun engine first
    await initializeRailgunEngine();
    
    // Test just the gas estimation with feeTokenDetails
    const gasDetails = await testGasEstimation();
    
    console.log('\n🎉 TEST PASSED!');
    console.log('gasEstimateForUnprovenUnshield completed successfully without chain property errors');
    console.log('This means our feeTokenDetails structure is correct for v10.4.x');
    
    return {
      success: true,
      gasDetails
    };
    
  } catch (error) {
    console.error('\n💥 TEST FAILED:', {
      errorType: error.constructor.name,
      errorMessage: error.message
    });
    
    if (error.message.includes("Cannot read properties of undefined (reading 'chain')")) {
      console.error('\n🔍 DIAGNOSIS: The chain property error occurred');
      console.error('This suggests our feeTokenDetails structure still needs adjustment');
      console.error('Check the chainId field and ensure it matches what the SDK expects');
    } else if (error.message.includes('RailgunEngine has not been started')) {
      console.error('\n🔍 DIAGNOSIS: Railgun engine not initialized');
      console.error('This is expected in a simple test - the engine needs proper setup first');
    } else if (error.message.includes('wallet') || error.message.includes('Wallet')) {
      console.error('\n🔍 DIAGNOSIS: Wallet-related error');
      console.error('This is expected with test wallet IDs - focus on feeTokenDetails structure');
    }
    
    return {
      success: false,
      error: error.message,
      errorType: error.constructor.name
    };
  }
}

// ===========================
// RUN TEST
// ===========================

if (import.meta.url === `file://${process.argv[1]}`) {
  runUnshieldTest()
    .then(result => {
      if (result.success) {
        console.log('\n✅ Test completed successfully');
        process.exit(0);
      } else {
        console.log('\n❌ Test failed');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('\n💥 Unhandled error:', error);
      process.exit(1);
    });
}

export { runUnshieldTest }; 