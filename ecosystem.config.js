const fs = require('fs')

const BASE = '/opt/teen-prod/services'
const ENV_FILE = (svc) => `${BASE}/${svc}/.env`

// Go binaries can't load dotenv themselves, so parse the service .env here
// and inject it via pm2's env object.
const LOAD_ENV = (svc) => {
  const out = {}
  try {
    for (const line of fs.readFileSync(ENV_FILE(svc), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !m[1].startsWith('#')) out[m[1]] = m[2]
    }
  } catch (_) { /* no .env — fall back to defaults baked into the binary */ }
  return out
}
const NODE_OPTS = { NODE_OPTIONS: '--max-old-space-size=120' }

module.exports = {
  apps: [
    // ── Core API: auth + users + leaderboard + notifications + betting (5 → 1) ──
    {
      name: 'teen-core-api',
      cwd: `${BASE}/core-api-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('core-api-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '350M',
      env: { ...NODE_OPTS, PORT: 3001 },
    },

    // ── Wallet: critical financial service, keep isolated ──
    {
      name: 'teen-wallet',
      cwd: `${BASE}/wallet-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('wallet-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },

    // ── Game Gateway: WebSocket hub ──
    // 3 fork-mode instances on distinct ports (3004/3021/3022), NOT PM2
    // cluster mode — cluster mode shares one port via SO_REUSEPORT with
    // plain round-robin, which breaks the Nginx consistent-hash session
    // affinity these need for WebSocket reconnects (this is likely why an
    // earlier cluster-mode attempt was reverted to instances:1, per the
    // prior comment here). Session state is shared via Redis
    // (session-manager.ts) so any instance can serve any player on
    // reconnect regardless of which one they land on.
    {
      name: 'teen-gateway',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3004 },
    },
    {
      name: 'teen-gateway-2',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3021 },
    },
    {
      name: 'teen-gateway-3',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3022 },
    },

    // ── Game Engines ──
    {
      name: 'teen-aviator',
      cwd: `${BASE}/game-engines/aviator`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/aviator'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
    {
      name: 'teen-ludo',
      cwd: `${BASE}/game-engines/ludo`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/ludo'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: NODE_OPTS,
    },
    {
      name: 'teen-tp-engine',
      cwd: `${BASE}/game-engines/teen-patti`,
      script: './teen-patti-engine',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { PORT: '3010', ...LOAD_ENV('game-engines/teen-patti') },
    },

    // ── Admin: keep separate — 2300+ lines with multipart KYC upload ──
    {
      name: 'teen-admin-svc',
      cwd: `${BASE}/admin-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('admin-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '250M',
      env: NODE_OPTS,
    },

    // ── Monitoring: WebSocket receiver from game-gateway + metrics ──
    {
      name: 'teen-monitoring',
      cwd: `${BASE}/monitoring-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('monitoring-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: NODE_OPTS,
    },

    // ── Risk: fraud detection API ──
    {
      name: 'teen-risk',
      cwd: `${BASE}/risk-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('risk-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: NODE_OPTS,
    },

    // ── Churn: background cron + admin HTTP ──
    {
      name: 'teen-churn',
      cwd: `${BASE}/churn-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('churn-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: NODE_OPTS,
    },

    // ── Churn ML: Local Python FastAPI Server ──
    {
      name: 'teen-churn-ml',
      cwd: `${BASE}/churn-ml-service`,
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 3020',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      interpreter: 'none',
      env: {
        DATABASE_URL: process.env.DATABASE_URL
      }
    },

    // ── App Monitor: Flutter SDK event ingest ──
    {
      name: 'teen-app-monitor',
      cwd: `${BASE}/app-monitor-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('app-monitor-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, NODE_ENV: 'production', PORT: 3015, GEOLITE2_CITY_PATH: '/opt/teen/geoip/GeoLite2-City.mmdb' },
    },

    // ── Uptime Bot: Monitoring service health + TCP ports, writes to JSON ──
    {
      name: 'teen-uptime-bot',
      cwd: `${BASE}/uptime-bot`,
      script: 'dist/index.js',
      env_file: ENV_FILE('uptime-bot'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '100M',
      env: { ...NODE_OPTS, UPTIME_STATUS_FILE: '/opt/teen/uptime-status.json' },
    },

    // ── Bot Learning: nightly bot-profile rebuild from real player data ──
    {
      name: 'teen-bot-learning',
      cwd: `${BASE}/bot-learning-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('bot-learning-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: NODE_OPTS,
    },
  ],
}
