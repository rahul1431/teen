const WebSocket = require('ws');
const { performance } = require('perf_hooks');

// Configuration
const TARGET_URL = 'wss://localhost:80/ws';
const CONCURRENT_CONNECTIONS = 100;
const MESSAGES_PER_CONNECTION = 10;
const HEARTBEAT_INTERVAL = 5000;
const CONNECTION_TIMEOUT = 15000; // Increased timeout

class ComprehensiveWebSocketTester {
  constructor() {
    this.results = {
      timestamp: new Date().toISOString(),
      target_url: TARGET_URL,
      connection_tests: CONCURRENT_CONNECTIONS,
      successful_connections: 0,
      failed_connections: 0,
      total_messages_sent: 0,
      total_messages_received: 0,
      latencies: [],
      error_details: new Map(),
    };
  }

  async testSingleConnection(index) {
    return new Promise((resolve) => {
      let ws = null;
      let messagesSent = 0;
      let messagesReceived = 0;
      let latencies = [];
      let heartbeatTimer = null;

      const timeout = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.CLOSED) {
          ws.close();
        }
        resolve({
          index,
          success: false,
          error: 'timeout',
          messagesSent,
          messagesReceived,
        });
      }, CONNECTION_TIMEOUT);

      try {
        ws = new WebSocket(TARGET_URL, {
          rejectUnauthorized: false,
          handshakeTimeout: 10000,
        });

        ws.on('open', () => {
          this.results.successful_connections++;
          clearTimeout(timeout);

          // Send initial hello
          try {
            const hello = JSON.stringify({
              type: 'hello',
              clientId: `test-client-${index}`,
              timestamp: Date.now(),
            });
            ws.send(hello);
            messagesSent++;
            this.results.total_messages_sent++;
          } catch (e) {
            // Ignore
          }

          // Heartbeat
          heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const heartbeat = JSON.stringify({
                  type: 'heartbeat',
                  timestamp: Date.now(),
                });
                ws.send(heartbeat);
                messagesSent++;
                this.results.total_messages_sent++;
              } catch (e) {
                // Ignore
              }
            }
          }, HEARTBEAT_INTERVAL);

          // Send test messages
          for (let i = 0; i < MESSAGES_PER_CONNECTION; i++) {
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                try {
                  const startTime = performance.now();
                  const message = JSON.stringify({
                    type: 'test',
                    id: `${index}-${i}`,
                    connectionId: index,
                    messageIndex: i,
                    timestamp: startTime,
                  });
                  ws.send(message);
                  messagesSent++;
                  this.results.total_messages_sent++;
                  latencies.push({ id: `${index}-${i}`, sentTime: startTime });
                } catch (e) {
                  // Ignore
                }
              }
            }, i * 500);
          }
        });

        ws.on('message', (data) => {
          try {
            messagesReceived++;
            this.results.total_messages_received++;
            const now = performance.now();

            // Try to parse as JSON for latency measurement
            try {
              const msg = JSON.parse(data);
              if (msg.id) {
                const sent = latencies.find(l => l.id === msg.id);
                if (sent) {
                  const latency = now - sent.sentTime;
                  this.results.latencies.push(latency);
                }
              }
            } catch (e) {
              // Not JSON, just count as received
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('close', (code, reason) => {
          clearInterval(heartbeatTimer);
          clearTimeout(timeout);
          resolve({
            index,
            success: messagesSent > 0,
            messagesSent,
            messagesReceived,
            closeCode: code,
          });
        });

        ws.on('error', (err) => {
          clearInterval(heartbeatTimer);
          clearTimeout(timeout);
          this.results.failed_connections++;

          const errorKey = err.code || err.message || 'UNKNOWN';
          if (!this.results.error_details.has(errorKey)) {
            this.results.error_details.set(errorKey, {
              code: err.code,
              message: err.message,
              count: 0,
            });
          }
          const entry = this.results.error_details.get(errorKey);
          entry.count++;

          resolve({
            index,
            success: false,
            error: errorKey,
            errorMessage: err.message,
            messagesSent,
            messagesReceived,
          });
        });

      } catch (err) {
        clearTimeout(timeout);
        this.results.failed_connections++;
        resolve({
          index,
          success: false,
          error: 'exception',
          errorMessage: err.message,
          messagesSent: 0,
          messagesReceived: 0,
        });
      }
    });
  }

  async runTests() {
    console.log('═════════════════════════════════════════════════════');
    console.log('WebSocket Gateway Comprehensive Stress Test');
    console.log('═════════════════════════════════════════════════════\n');
    console.log(`Target URL: ${TARGET_URL}`);
    console.log(`Concurrent Connections: ${CONCURRENT_CONNECTIONS}`);
    console.log(`Messages per Connection: ${MESSAGES_PER_CONNECTION}`);
    console.log(`Heartbeat Interval: ${HEARTBEAT_INTERVAL}ms`);
    console.log(`Connection Timeout: ${CONNECTION_TIMEOUT}ms`);
    console.log('\nStarting test... (this will take ~20-30 seconds)\n');

    const startTime = Date.now();

    // Staggered connection attempts
    const connectionPromises = [];
    for (let i = 0; i < CONCURRENT_CONNECTIONS; i++) {
      connectionPromises.push(this.testSingleConnection(i));
      if (i % 10 === 0) {
        process.stdout.write(`\r${i}/${CONCURRENT_CONNECTIONS} connections initiated...`);
      }
      // Stagger by 30ms
      await new Promise(resolve => setTimeout(resolve, 30));
    }

    console.log(`\r${CONCURRENT_CONNECTIONS}/${CONCURRENT_CONNECTIONS} connections initiated`);
    console.log('Waiting for all connections to complete...\n');

    const results = await Promise.all(connectionPromises);
    const testDuration = (Date.now() - startTime) / 1000;

    // Collect stats
    const successCount = results.filter(r => r.success).length;
    const failureCount = CONCURRENT_CONNECTIONS - successCount;

    return {
      ...this.results,
      individual_results_summary: {
        successful: successCount,
        failed: failureCount,
        success_rate_percent: Number(((successCount / CONCURRENT_CONNECTIONS) * 100).toFixed(2)),
      },
      error_details_summary: Object.fromEntries(this.results.error_details),
      test_duration_seconds: Number(testDuration.toFixed(2)),
    };
  }

  formatResults(rawResults) {
    const latencies = rawResults.latencies;

    let avgLatency = 0;
    let minLatency = Infinity;
    let maxLatency = 0;

    if (latencies.length > 0) {
      const sorted = [...latencies].sort((a, b) => a - b);
      avgLatency = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      minLatency = sorted[0];
      maxLatency = sorted[sorted.length - 1];
    }

    const duration = rawResults.test_duration_seconds;
    const throughput = duration > 0 ? rawResults.total_messages_received / duration : 0;
    const messageLoss = rawResults.total_messages_sent - rawResults.total_messages_received;
    const successRate = rawResults.individual_results_summary.success_rate_percent;

    // Assessment logic
    let assessment = 'OK';
    if (successRate < 90 || avgLatency > 1000) {
      assessment = 'WARNING';
    }
    if (successRate < 50 || rawResults.failed_connections > rawResults.successful_connections) {
      assessment = 'CRITICAL';
    }
    if (successRate === 0) {
      assessment = 'CRITICAL';
    }

    return {
      connection_tests: rawResults.connection_tests,
      successful_connections: rawResults.successful_connections,
      failed_connections: rawResults.failed_connections,
      success_rate_percent: successRate,
      total_messages_sent: rawResults.total_messages_sent,
      total_messages_received: rawResults.total_messages_received,
      message_loss_count: messageLoss,
      message_loss_detected: messageLoss > 0,
      avg_latency_ms: Number(avgLatency.toFixed(2)),
      min_latency_ms: minLatency === Infinity ? 0 : Number(minLatency.toFixed(2)),
      max_latency_ms: Number(maxLatency.toFixed(2)),
      throughput_msgs_per_sec: Number(throughput.toFixed(2)),
      recovery_time_ms: 0,
      test_duration_seconds: duration,
      assessment: assessment,
      timestamp: rawResults.timestamp,
      error_summary: rawResults.error_details_summary,
    };
  }

  async run() {
    try {
      const rawResults = await this.runTests();
      return this.formatResults(rawResults);
    } catch (error) {
      console.error('Fatal test error:', error.message);
      return {
        connection_tests: CONCURRENT_CONNECTIONS,
        successful_connections: 0,
        failed_connections: CONCURRENT_CONNECTIONS,
        success_rate_percent: 0,
        avg_latency_ms: 0,
        throughput_msgs_per_sec: 0,
        recovery_time_ms: 0,
        message_loss_detected: true,
        assessment: 'CRITICAL',
        error: error.message,
      };
    }
  }
}

// Main execution
async function main() {
  const tester = new ComprehensiveWebSocketTester();
  const results = await tester.run();

  console.log('\n═════════════════════════════════════════════════════');
  console.log('TEST RESULTS');
  console.log('═════════════════════════════════════════════════════\n');
  console.log(JSON.stringify(results, null, 2));

  if (results.error_summary && Object.keys(results.error_summary).length > 0) {
    console.log('\n═════════════════════════════════════════════════════');
    console.log('ERROR ANALYSIS');
    console.log('═════════════════════════════════════════════════════\n');

    if (results.error_summary.ECONNREFUSED) {
      console.log('⚠️  CONNECTION REFUSED - Server is not listening');
      console.log('\n   To start the game gateway server:');
      console.log('   1. Open a terminal in: .claude/worktrees/parallel-roaming-blossom/services/game-gateway/');
      console.log('   2. Run: npm install');
      console.log('   3. Run: npm run dev');
      console.log('   4. Re-run this test\n');
    }
  }

  if (results.assessment === 'OK') {
    console.log('\n✅ Gateway is healthy and performing well\n');
  } else if (results.assessment === 'WARNING') {
    console.log('\n⚠️  Gateway has performance issues\n');
  } else if (results.assessment === 'CRITICAL') {
    console.log('\n❌ Gateway is not operational or experiencing critical issues\n');
  }
}

main().catch(console.error);
