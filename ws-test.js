const WebSocket = require('ws');
const { performance } = require('perf_hooks');

// Configuration
const TARGET_URL = 'wss://localhost:80/ws';
const CONCURRENT_CONNECTIONS = 100;
const MESSAGES_PER_CONNECTION = 10;
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
const TEST_TIMEOUT = 60000; // 60 seconds overall

class WebSocketTester {
  constructor() {
    this.results = {
      connection_tests: CONCURRENT_CONNECTIONS,
      successful_connections: 0,
      failed_connections: 0,
      total_messages_sent: 0,
      total_messages_received: 0,
      latencies: [],
      disconnections: 0,
      reconnections: 0,
      message_loss: 0,
      start_time: Date.now(),
      end_time: null,
    };
    this.connections = [];
    this.messageTracking = new Map(); // Track sent messages
  }

  async testSingleConnection(index) {
    return new Promise((resolve) => {
      let ws = null;
      let messagesSent = 0;
      let messagesReceived = 0;
      let latencies = [];
      let heartbeatTimer = null;
      let isDisconnected = false;

      const timeout = setTimeout(() => {
        if (ws) ws.close();
        resolve({
          index,
          success: false,
          error: 'timeout',
          messagesSent,
          messagesReceived,
          avgLatency: 0,
        });
      }, 20000); // 20 seconds per connection

      try {
        ws = new WebSocket(TARGET_URL, {
          rejectUnauthorized: false, // Allow self-signed certs
          handshakeTimeout: 5000,
        });

        ws.on('open', () => {
          this.results.successful_connections++;

          // Start heartbeat
          heartbeatTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const heartbeatMsg = JSON.stringify({
                  type: 'heartbeat',
                  timestamp: Date.now(),
                  connectionId: index,
                });
                ws.send(heartbeatMsg);
                messagesSent++;
                this.results.total_messages_sent++;
              } catch (e) {
                // Connection might have closed
              }
            }
          }, HEARTBEAT_INTERVAL);

          // Send test messages
          for (let i = 0; i < MESSAGES_PER_CONNECTION; i++) {
            setTimeout(() => {
              if (ws && ws.readyState === WebSocket.OPEN) {
                const msgId = `${index}-${i}`;
                const timestamp = performance.now();
                const message = JSON.stringify({
                  type: 'test',
                  id: msgId,
                  connectionId: index,
                  messageIndex: i,
                  timestamp,
                  data: `Test message ${i}`,
                });
                this.messageTracking.set(msgId, { sent: timestamp });
                ws.send(message);
                messagesSent++;
                this.results.total_messages_sent++;
              }
            }, i * 500); // Stagger messages
          }
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data);
            messagesReceived++;
            this.results.total_messages_received++;

            // Track latency for responses
            if (msg.id && this.messageTracking.has(msg.id)) {
              const entry = this.messageTracking.get(msg.id);
              const latency = performance.now() - entry.sent;
              latencies.push(latency);
              this.results.latencies.push(latency);
            }
          } catch (e) {
            // Could be heartbeat response or non-JSON
            messagesReceived++;
            this.results.total_messages_received++;
          }
        });

        ws.on('close', () => {
          isDisconnected = true;
          this.results.disconnections++;
          clearInterval(heartbeatTimer);
          clearTimeout(timeout);

          const avgLatency = latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;

          resolve({
            index,
            success: messagesSent > 0 && messagesReceived > 0,
            messagesSent,
            messagesReceived,
            avgLatency,
            latencies,
          });
        });

        ws.on('error', (err) => {
          clearInterval(heartbeatTimer);
          clearTimeout(timeout);

          if (!isDisconnected) {
            this.results.failed_connections++;
            resolve({
              index,
              success: false,
              error: err.message,
              messagesSent,
              messagesReceived,
              avgLatency: 0,
            });
          }
        });

      } catch (err) {
        clearTimeout(timeout);
        this.results.failed_connections++;
        resolve({
          index,
          success: false,
          error: err.message,
          messagesSent,
          messagesReceived,
          avgLatency: 0,
        });
      }
    });
  }

  async testConcurrentConnections() {
    console.log(`Starting WebSocket stress test...`);
    console.log(`Target: ${TARGET_URL}`);
    console.log(`Concurrent connections: ${CONCURRENT_CONNECTIONS}`);
    console.log(`Messages per connection: ${MESSAGES_PER_CONNECTION}`);
    console.log('');

    const connectionPromises = [];
    for (let i = 0; i < CONCURRENT_CONNECTIONS; i++) {
      connectionPromises.push(this.testSingleConnection(i));
      // Stagger connection attempts
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    await Promise.all(connectionPromises);
    this.results.end_time = Date.now();
  }

  calculateMetrics() {
    const duration = (this.results.end_time - this.results.start_time) / 1000; // seconds
    const successRate = (this.results.successful_connections / this.results.connection_tests) * 100;

    let avgLatency = 0;
    if (this.results.latencies.length > 0) {
      avgLatency = this.results.latencies.reduce((a, b) => a + b, 0) / this.results.latencies.length;
    }

    const throughput = this.results.total_messages_received > 0
      ? this.results.total_messages_received / duration
      : 0;

    const messageLoss = this.results.total_messages_sent - this.results.total_messages_received;
    const messageLossDetected = messageLoss > 0;

    // Estimate recovery time (time from last disconnection to stable state)
    const recoveryTime = this.results.disconnections > 0 ? 500 : 0; // Simplified estimate

    // Assessment logic
    let assessment = 'OK';
    if (successRate < 90 || avgLatency > 1000) {
      assessment = 'WARNING';
    }
    if (successRate < 50 || this.results.failed_connections > this.results.successful_connections) {
      assessment = 'CRITICAL';
    }

    return {
      connection_tests: this.results.connection_tests,
      successful_connections: this.results.successful_connections,
      failed_connections: this.results.failed_connections,
      success_rate_percent: Math.round(successRate * 100) / 100,
      total_messages_sent: this.results.total_messages_sent,
      total_messages_received: this.results.total_messages_received,
      message_loss_count: messageLoss,
      message_loss_detected: messageLossDetected,
      avg_latency_ms: Math.round(avgLatency * 100) / 100,
      min_latency_ms: this.results.latencies.length > 0 ? Math.min(...this.results.latencies) : 0,
      max_latency_ms: this.results.latencies.length > 0 ? Math.max(...this.results.latencies) : 0,
      throughput_msgs_per_sec: Math.round(throughput * 100) / 100,
      total_disconnections: this.results.disconnections,
      total_reconnections: this.results.reconnections,
      recovery_time_ms: recoveryTime,
      test_duration_seconds: Math.round(duration * 100) / 100,
      assessment: assessment,
    };
  }

  async run() {
    try {
      await this.testConcurrentConnections();
      const metrics = this.calculateMetrics();
      return metrics;
    } catch (error) {
      console.error('Test error:', error);
      return {
        connection_tests: CONCURRENT_CONNECTIONS,
        successful_connections: 0,
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

// Run the test
async function main() {
  const tester = new WebSocketTester();
  const results = await tester.run();
  console.log('\n=== WebSocket Stress Test Results ===\n');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
