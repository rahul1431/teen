const fs = require('fs')

const BASE = '/opt/teen-dev/services'
const ENV_FILE = (svc) => `${BASE}/${svc}/.env.dev`

// Load .env.dev files for services — returns all key/value pairs
const LOAD_ENV = (svc) => {
  const out = {}
  try {
    const envPath = `${BASE}/${svc}/.env.dev`
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m && !m[1].startsWith('#')) out[m[1]] = m[2]
      }
    }
  } catch (_) { /* no .env.dev — fall back to defaults baked into the binary */ }
  return out
}

const NODE_OPTS = { NODE_OPTIONS: '--max-old-space-size=120', NODE_ENV: 'development' }

module.exports = {
  apps: [
    // ── Core API: auth + users + leaderboard + notifications + betting ──
    // DEV PORT: 3201 (vs PROD: 3001)
    {
      name: 'teen-core-api-dev',
      cwd: `${BASE}/core-api-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('core-api-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '350M',
      env: { ...NODE_OPTS, ...LOAD_ENV('core-api-service'), PORT: 3201 },
    },

    // ── Wallet: critical financial service, keep isolated ──
    // DEV PORT: 3203 (vs PROD: 3003)
    {
      name: 'teen-wallet-dev',
      cwd: `${BASE}/wallet-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('wallet-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { ...NODE_OPTS, ...LOAD_ENV('wallet-service'), PORT: 3203 },
    },

    // ── Game Gateway: WebSocket hub ──
    // DEV PORTS: 3204/3221/3222 (vs PROD: 3004/3021/3022)
    {
      name: 'teen-gateway-dev',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3204 },
    },
    {
      name: 'teen-gateway-2-dev',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3221 },
    },
    {
      name: 'teen-gateway-3-dev',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-gateway'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3222 },
    },

    // ── Game Engines ──
    {
      name: 'teen-aviator-dev',
      cwd: `${BASE}/game-engines/aviator`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/aviator'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-engines/aviator'), PORT: 3205 },
    },
    {
      name: 'teen-ludo-dev',
      cwd: `${BASE}/game-engines/ludo`,
      script: 'dist/index.js',
      env_file: ENV_FILE('game-engines/ludo'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-engines/ludo'), PORT: 3211 },
    },
    {
      name: 'teen-tp-engine-dev',
      cwd: `${BASE}/game-engines/teen-patti`,
      script: './teen-patti-engine',
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { PORT: '3210', ...LOAD_ENV('game-engines/teen-patti') },
    },

    // ── Admin: keep separate — 2300+ lines with multipart KYC upload ──
    // DEV PORT: 3208 (vs PROD: 3008)
    {
      name: 'teen-admin-svc-dev',
      cwd: `${BASE}/admin-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('admin-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '250M',
      env: { ...NODE_OPTS, ...LOAD_ENV('admin-service'), PORT: 3208 },
    },

    // ── Monitoring: WebSocket receiver from game-gateway + metrics ──
    // DEV PORT: 3217 (vs PROD: 3017)
    {
      name: 'teen-monitoring-dev',
      cwd: `${BASE}/monitoring-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('monitoring-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('monitoring-service'), PORT: 3217 },
    },

    // ── Risk: fraud detection API ──
    // DEV PORT: 3206 (vs PROD: 3006)
    {
      name: 'teen-risk-dev',
      cwd: `${BASE}/risk-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('risk-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('risk-service'), PORT: 3206 },
    },

    // ── Churn: background cron + admin HTTP ──
    // DEV PORT: 3213 (vs PROD: 3013)
    {
      name: 'teen-churn-dev',
      cwd: `${BASE}/churn-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('churn-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('churn-service'), PORT: 3213 },
    },

    // ── Churn ML: Local Python FastAPI Server ──
    // DEV PORT: 3220 (vs PROD: 3020)
    {
      name: 'teen-churn-ml-dev',
      cwd: `${BASE}/churn-ml-service`,
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 3220',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
        ...LOAD_ENV('churn-ml-service'),
      }
    },

    // ── App Monitor: Flutter SDK event ingest ──
    // DEV PORT: 3215 (vs PROD: 3015)
    {
      name: 'teen-app-monitor-dev',
      cwd: `${BASE}/app-monitor-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('app-monitor-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('app-monitor-service'), NODE_ENV: 'development', PORT: 3215, GEOLITE2_CITY_PATH: '/opt/teen-dev/geoip/GeoLite2-City.mmdb' },
    },

    // ── Uptime Bot: Monitoring service health + TCP ports, writes to JSON ──
    {
      name: 'teen-uptime-bot-dev',
      cwd: `${BASE}/uptime-bot`,
      script: 'dist/index.js',
      env_file: ENV_FILE('uptime-bot'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '100M',
      env: { ...NODE_OPTS, ...LOAD_ENV('uptime-bot'), UPTIME_STATUS_FILE: '/opt/teen-dev/uptime-status-dev.json' },
    },

    // ── Bot Learning: nightly bot-profile rebuild from real player data ──
    {
      name: 'teen-bot-learning-dev',
      cwd: `${BASE}/bot-learning-service`,
      script: 'dist/index.js',
      env_file: ENV_FILE('bot-learning-service'),
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('bot-learning-service') },
    },
  ],
}
