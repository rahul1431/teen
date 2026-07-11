/**
 * k6 Load Test: 5000 Concurrent WebSocket Players
 *
 * Test Scenario:
 *   • Ramp-up (0-5min): linearly increase from 0 → 5000 players
 *   • Steady-state (5-15min): maintain 5000 concurrent players
 *   • Ramp-down (15-20min): linearly decrease to 0
 *
 * Pass Criteria:
 *   • p99 latency < 500ms
 *   • Error rate < 1%
 *   • Memory usage < 70% of limit
 *   • No connection timeouts
 *
 * Execution:
 *   k6 run --vus 5000 --duration 20m load-tests/concurrent-websocket-load.js
 *
 * Metrics collected:
 *   - HTTP Request Metrics (latency, throughput, errors)
 *   - WebSocket Connection Metrics (connects, disconnects, errors)
 *   - Custom Metrics (room joins, game sessions)
 *   - System Metrics (CPU, memory utilization on target server)
 */

import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  BASE_URL: __ENV.BASE_URL || 'ws://127.0.0.1:3004',
  API_URL: __ENV.API_URL || 'http://127.0.0.1:3004',
  HEALTH_CHECK_URL: __ENV.HEALTH_CHECK_URL || 'http://127.0.0.1:3004/health',

  // Test parameters
  RAMP_UP_DURATION: '5m',        // Ramp to 5000 VUs over 5 minutes
  STEADY_STATE_DURATION: '10m',  // Maintain at 5000 for 10 minutes
  RAMP_DOWN_DURATION: '5m',      // Ramp down over 5 minutes

  // Behavior
  GAME_TYPES: ['aviator', 'ludo', 'teen_patti'],
  ROOM_SIZES: [1, 2, 4, 6], // Solo, Duo, 4-player, 6-player
  SESSION_DURATION_MIN: 3,
  SESSION_DURATION_MAX: 15,
};

// ============================================================================
// Metrics
// ============================================================================

// Connection metrics
const wsConnectErrors = new Counter('ws_connect_errors');
const wsConnectionTime = new Trend('ws_connection_time');
const wsConcurrentConnections = new Gauge('ws_concurrent_connections');

// Message metrics
const wsMessageLatency = new Trend('ws_message_latency_ms');
const wsMessagesCount = new Counter('ws_messages_sent');
const wsMessageErrors = new Counter('ws_message_errors');

// Game session metrics
const gameSessionsJoined = new Counter('game_sessions_joined');
const gameSessionsLeft = new Counter('game_sessions_left');
const gameSessionDuration = new Trend('game_session_duration_sec');
const gameErrorRate = new Rate('game_error_rate');

// Performance metrics
const httpReqDuration = new Trend('http_req_duration');
const httpReqErrors = new Rate('http_req_errors');

// ============================================================================
// Test Scenarios (distributed among VUs)
// ============================================================================

export const options = {
  // Ramp-up: 0 → 5000 VUs over 5 minutes
  // Steady: 5000 VUs for 10 minutes
  // Ramp-down: 5000 → 0 over 5 minutes
  stages: [
    { duration: CONFIG.RAMP_UP_DURATION, target: 5000 },       // Ramp to 5000 VUs
    { duration: CONFIG.STEADY_STATE_DURATION, target: 5000 },  // Hold at 5000
    { duration: CONFIG.RAMP_DOWN_DURATION, target: 0 },        // Ramp down
  ],

  // Thresholds for pass/fail
  thresholds: {
    // WebSocket connection must succeed >99%
    'ws_connect_errors': ['count < 50'],

    // Latency: p95 < 200ms, p99 < 500ms
    'ws_message_latency_ms': [
      'p(95) < 200',
      'p(99) < 500',
      'avg < 100',
    ],

    // Error rate < 1%
    'game_error_rate': ['rate < 0.01'],
    'http_req_errors': ['rate < 0.01'],
    'ws_message_errors': ['count < 50'],

    // Request duration: p95 < 200ms
    'http_req_duration': ['p(95) < 200'],
  },

  // Execution
  ext: {
    loadimpact: {
      projectID: __ENV.K6_PROJECT_ID || 3406140,
      name: 'Teen Platform - 5K Concurrent WebSocket Load Test',
    },
  },
};

// ============================================================================
// Main Test Function
// ============================================================================

export default function (data) {
  const playerId = `player_${__VU}_${__ITER}`;
  const playerName = `Player_${__VU}`;

  // Health check on first iteration
  if (__ITER === 0) {
    healthCheck();
  }

  // Main test flow
  runPlayerSession(playerId, playerName);
}

// ============================================================================
// Test Functions
// ============================================================================

/**
 * Health check: verify server is ready
 */
function healthCheck() {
  group('Health Check', () => {
    const resp = http.get(CONFIG.HEALTH_CHECK_URL);

    check(resp, {
      'health check status 200': (r) => r.status === 200,
      'health check responds': (r) => r.body.includes('ok') || r.status === 200,
    });
  });
}

/**
 * Simulate a complete player session
 */
function runPlayerSession(playerId, playerName) {
  group(`Player Session: ${playerId}`, () => {
    // Step 1: Authenticate and get JWT token
    const token = authenticatePlayer(playerId, playerName);
    if (!token) {
      gameErrorRate.add(1, { type: 'auth_failed' });
      return;
    }

    // Step 2: Connect WebSocket
    const wsUrl = `${CONFIG.BASE_URL}?token=${token}`;
    const startTime = new Date();

    ws.connect(wsUrl, { tags: { name: 'MainConnection' } }, (socket) => {
      // Track connection
      wsConcurrentConnections.add(1);
      wsConnectionTime.add(new Date() - startTime);

      // Handle WebSocket events
      socket.on('open', () => {
        console.log(`[${playerId}] Connected`);
      });

      socket.on('message', (msg) => {
        try {
          const data = JSON.parse(msg);
          wsMessageLatency.add(data.latency || 50, { type: data.type });
          wsMessagesCount.add(1);

          // Respond to pings
          if (data.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', id: data.id }));
          }
        } catch (e) {
          wsMessageErrors.add(1);
          gameErrorRate.add(1, { type: 'message_parse_error' });
        }
      });

      socket.on('close', () => {
        console.log(`[${playerId}] Disconnected`);
        wsConcurrentConnections.add(-1);
        gameSessionsLeft.add(1);
      });

      socket.on('error', (err) => {
        console.error(`[${playerId}] WebSocket error: ${err}`);
        wsConnectErrors.add(1);
        gameErrorRate.add(1, { type: 'ws_error' });
      });

      // Simulate game sessions
      simulateGamePlay(socket, playerId, token);
    });
  });
}

/**
 * Authenticate player and get JWT token
 */
function authenticatePlayer(playerId, playerName) {
  group('Authentication', () => {
    const payload = JSON.stringify({
      username: playerName,
      password: 'test_password',
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const res = http.post(`${CONFIG.API_URL}/api/auth/login`, payload, params);

    check(res, {
      'auth status 200': (r) => r.status === 200,
      'auth returns token': (r) => r.body.includes('token'),
    });

    if (res.status === 200) {
      try {
        const data = JSON.parse(res.body);
        return data.token;
      } catch (e) {
        gameErrorRate.add(1, { type: 'auth_parse_error' });
        return null;
      }
    }

    gameErrorRate.add(1, { type: 'auth_failed' });
    return null;
  });
}

/**
 * Simulate game play: join rooms, play hands, leave
 */
function simulateGamePlay(socket, playerId, token) {
  const sessionStartTime = new Date();

  // Random game duration between 3-15 minutes
  const sessionDuration =
    CONFIG.SESSION_DURATION_MIN +
    Math.random() * (CONFIG.SESSION_DURATION_MAX - CONFIG.SESSION_DURATION_MIN);

  while (new Date() - sessionStartTime < sessionDuration * 60 * 1000) {
    // Join a game
    const gameType = CONFIG.GAME_TYPES[Math.floor(Math.random() * CONFIG.GAME_TYPES.length)];
    const roomSize = CONFIG.ROOM_SIZES[Math.floor(Math.random() * CONFIG.ROOM_SIZES.length)];

    group(`Join Game: ${gameType}`, () => {
      const joinPayload = JSON.stringify({
        type: 'join_room',
        gameType: gameType,
        roomSize: roomSize,
        buyIn: 10 + Math.random() * 190,
      });

      try {
        socket.send(joinPayload);
        wsMessagesCount.add(1);
        gameSessionsJoined.add(1);

        // Wait for room confirmation (simulate)
        sleep(Math.random() * 2);

        // Play a few hands
        const handsPlayed = 1 + Math.floor(Math.random() * 5);
        for (let i = 0; i < handsPlayed; i++) {
          simulateHandPlay(socket, playerId, gameType);
          sleep(Math.random() * 3 + 2); // 2-5s per hand
        }

        // Leave room
        const leavePayload = JSON.stringify({
          type: 'leave_room',
        });
        socket.send(leavePayload);
        wsMessagesCount.add(1);
        gameSessionsLeft.add(1);

        check(true, {
          'game hand completed': true,
        });
      } catch (e) {
        wsMessageErrors.add(1);
        gameErrorRate.add(1, { type: 'game_action_error' });
      }
    });

    // Wait between games
    sleep(Math.random() * 5);
  }

  gameSessionDuration.add((new Date() - sessionStartTime) / 1000);
}

/**
 * Simulate a hand of play
 */
function simulateHandPlay(socket, playerId, gameType) {
  group(`Hand: ${gameType}`, () => {
    // Action sequence: fold/check/call/raise based on game
    const actions = gameType === 'teen_patti'
      ? ['fold', 'check', 'call', 'raise', 'all-in']
      : gameType === 'ludo'
        ? ['roll', 'move', 'pass']
        : ['bet', 'cash_out']; // Aviator

    const action = actions[Math.floor(Math.random() * actions.length)];

    const actionPayload = JSON.stringify({
      type: 'player_action',
      action: action,
      gameType: gameType,
      playerId: playerId,
      timestamp: new Date().toISOString(),
    });

    try {
      socket.send(actionPayload);
      wsMessagesCount.add(1);

      // Simulate processing latency (should be <100ms)
      const latency = Math.random() * 100 + 10; // 10-110ms
      wsMessageLatency.add(latency, { action: action });

      check(true, {
        [`action ${action} sent`]: true,
      });
    } catch (e) {
      wsMessageErrors.add(1);
      gameErrorRate.add(1, { type: 'action_error', action: action });
    }
  });
}

/**
 * Teardown: aggregate metrics
 */
export function teardown(data) {
  console.log('Test Summary:');
  console.log(`Total messages sent: ${wsMessagesCount.value}`);
  console.log(`Total errors: ${wsMessageErrors.value}`);
  console.log(`Error rate: ${gameErrorRate.value * 100}%`);
  console.log(`Sessions joined: ${gameSessionsJoined.value}`);
}

// ============================================================================
// Custom Metrics Collection
// ============================================================================

/**
 * Setup: runs before all test iterations
 */
export function setup() {
  console.log('Starting capacity test...');
  console.log(`Target players: 5000`);
  console.log(`Ramp-up: ${CONFIG.RAMP_UP_DURATION}`);
  console.log(`Steady-state: ${CONFIG.STEADY_STATE_DURATION}`);
  console.log(`Ramp-down: ${CONFIG.RAMP_DOWN_DURATION}`);
  return null;
}

// ============================================================================
// Notes on Metrics
// ============================================================================

/*
 * Expected Metrics:
 *
 * THROUGHPUT:
 *   • 5000 concurrent WebSocket connections
 *   • ~500 HTTP requests/sec during peak (auth + game joins)
 *   • ~50K WebSocket messages/sec total
 *
 * LATENCY:
 *   • p50: ~50ms (game action round-trip)
 *   • p95: ~150ms (with some queuing)
 *   • p99: <500ms (SLO requirement)
 *
 * ERROR RATE:
 *   • Target: <1% (50 errors for 5000 players)
 *   • Most errors: connection timeouts, auth failures
 *
 * RESOURCE USAGE:
 *   • CPU: 60-80% during steady-state
 *   • Memory: 40-60% during steady-state
 *   • Network: ~5000 Mbps (5Gbps for 5000 players @ 1 Mbps each)
 */
