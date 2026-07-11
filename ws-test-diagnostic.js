const WebSocket = require('ws');

// Test a single connection with detailed error reporting
async function testConnection() {
  console.log('Attempting to connect to wss://localhost:80/ws...\n');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('Connection timeout - server not responding');
      resolve({
        status: 'timeout',
        details: 'Connection attempt timed out after 10 seconds'
      });
    }, 10000);

    try {
      const ws = new WebSocket('wss://localhost:80/ws', {
        rejectUnauthorized: false,
      });

      ws.on('open', () => {
        clearTimeout(timeout);
        console.log('✓ Connection successful');
        console.log(`WebSocket state: ${ws.readyState}`);
        console.log(`Protocol: ${ws.protocol}`);

        // Test heartbeat
        const heartbeat = JSON.stringify({ type: 'heartbeat', timestamp: Date.now() });
        ws.send(heartbeat);
        console.log('\n✓ Sent heartbeat message');

        ws.on('message', (data) => {
          console.log('✓ Received response:', data.toString().slice(0, 100));
        });

        setTimeout(() => {
          ws.close();
          resolve({ status: 'connected', message: 'Server is running and responding' });
        }, 2000);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        console.log('✗ Connection error:', err.message);
        console.log(`Error code: ${err.code}`);
        resolve({
          status: 'error',
          error_code: err.code,
          error_message: err.message,
          details: getErrorDetails(err.code)
        });
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeout);
        if (resolve) {
          resolve({
            status: 'closed',
            code,
            reason: reason ? reason.toString() : 'No reason provided'
          });
        }
      });

    } catch (error) {
      clearTimeout(timeout);
      console.log('✗ Exception:', error.message);
      resolve({
        status: 'exception',
        error: error.message
      });
    }
  });
}

function getErrorDetails(code) {
  const errors = {
    'ECONNREFUSED': 'Connection refused - server is not listening on this port',
    'ENOTFOUND': 'Server hostname/IP not found',
    'EHOSTUNREACH': 'Host is unreachable',
    'ENETUNREACH': 'Network is unreachable',
    'ERR_TLS_CERT_ALTNAME_INVALID': 'TLS certificate validation failed for hostname',
    'ERR_TLS_HANDSHAKE_FAILURE': 'TLS handshake failed',
  };
  return errors[code] || 'Unknown error';
}

async function main() {
  const result = await testConnection();
  console.log('\n=== Diagnostic Result ===');
  console.log(JSON.stringify(result, null, 2));

  if (result.status === 'error' && result.error_code === 'ECONNREFUSED') {
    console.log('\n⚠️  ACTION REQUIRED: Start the game gateway server before running tests');
    console.log('Look for: npm run dev or npm start in the project');
  }
}

main().catch(console.error);
