import { useEffect, useState } from 'react';
import { checkRelayerHealth, RelayerConfig } from '../utils/railgun/relayer-client';

export default function TestRelayer() {
  const [status, setStatus] = useState('Testing...');
  const [logs, setLogs] = useState([]);

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { message, type, timestamp: new Date().toISOString() }]);
  };

  useEffect(() => {
    const testRelayer = async () => {
      try {
        addLog('🧪 Starting relayer integration test');
        
        // Test 1: Check environment variables
        addLog(`📋 RELAYER_ENABLED: ${process.env.REACT_APP_RELAYER_ENABLED}`);
        addLog(`📋 LEXIE_HMAC_SECRET: ${process.env.LEXIE_HMAC_SECRET ? 'SET' : 'NOT SET'}`, 
               process.env.LEXIE_HMAC_SECRET ? 'success' : 'error');
        addLog(`📋 RELAYER_ADDRESS: ${process.env.REACT_APP_RELAYER_ADDRESS || 'NOT SET'}`,
               process.env.REACT_APP_RELAYER_ADDRESS ? 'success' : 'error');
        
        // Test 2: Check relayer config
        addLog(`⚙️ Relayer Config - URL: ${RelayerConfig.url}`);
        addLog(`⚙️ Relayer Config - Enabled: ${RelayerConfig.enabled}`, 
               RelayerConfig.enabled ? 'success' : 'error');
        
        // Test 3: Test health endpoint
        addLog('🏥 Testing health endpoint...');
        const isHealthy = await checkRelayerHealth();
        addLog(`🏥 Health check result: ${isHealthy}`, isHealthy ? 'success' : 'error');
        
        setStatus(isHealthy ? '✅ All tests passed!' : '❌ Some tests failed');
        
      } catch (error) {
        addLog(`❌ Test failed: ${error.message}`, 'error');
        setStatus('❌ Test failed');
      }
    };

    testRelayer();
  }, []);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>🚀 Gas Relayer Integration Test</h1>
      <div style={{ marginBottom: '20px', fontSize: '18px' }}>
        Status: <span style={{ 
          color: status.includes('✅') ? 'green' : status.includes('❌') ? 'red' : 'orange' 
        }}>{status}</span>
      </div>
      
      <div style={{ 
        backgroundColor: '#f5f5f5', 
        padding: '15px', 
        borderRadius: '5px',
        maxHeight: '400px',
        overflowY: 'auto'
      }}>
        {logs.map((log, index) => (
          <div key={index} style={{
            marginBottom: '5px',
            color: log.type === 'error' ? 'red' : log.type === 'success' ? 'green' : 'black'
          }}>
            [{log.timestamp.split('T')[1].split('.')[0]}] {log.message}
          </div>
        ))}
      </div>
      
      <div style={{ marginTop: '20px', fontSize: '14px', color: '#666' }}>
        <p>🔍 This page tests the gas relayer integration without making actual transactions.</p>
        <p>📝 Check the logs above to see what's working and what needs to be fixed.</p>
      </div>
    </div>
  );
}