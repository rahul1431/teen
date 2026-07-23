import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Writing clean ecosystem.dev.config.js...")
        
        dev_config_content = """const fs = require('fs')

const BASE = '/opt/teen/services'
const ENV_FILE = (svc) => `${BASE}/${svc}/.env.dev`

const LOAD_ENV = (svc) => {
  const out = {}
  try {
    const envPath = ENV_FILE(svc)
    if (fs.existsSync(envPath)) {
      for (const line of fs.readFileSync(envPath, 'utf8').split('\\n')) {
        const m = line.match(/^\\s*([A-Za-z0-9_]+)\\s*=\\s*(.*?)\\s*$/)
        if (m && !m[1].startsWith('#')) out[m[1]] = m[2].trim()
      }
    }
  } catch (_) {}
  return out
}

const NODE_OPTS = { NODE_OPTIONS: '--max-old-space-size=120', NODE_ENV: 'development' }

module.exports = {
  apps: [
    {
      name: 'teen-core-api-dev',
      cwd: `${BASE}/core-api-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '350M',
      env: { ...NODE_OPTS, ...LOAD_ENV('core-api-service'), PORT: 3201 },
    },
    {
      name: 'teen-wallet-dev',
      cwd: `${BASE}/wallet-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '200M',
      env: { ...NODE_OPTS, ...LOAD_ENV('wallet-service'), PORT: 3203 },
    },
    {
      name: 'teen-gateway-dev',
      cwd: `${BASE}/game-gateway`,
      script: 'dist/index.js',
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
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '300M',
      env: { ...NODE_OPTS, ...LOAD_ENV('game-gateway'), PORT: 3222 },
    },
    {
      name: 'teen-aviator-dev',
      cwd: `${BASE}/game-engines/aviator`,
      script: 'dist/index.js',
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
    {
      name: 'teen-admin-svc-dev',
      cwd: `${BASE}/admin-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '250M',
      env: { ...NODE_OPTS, ...LOAD_ENV('admin-service'), PORT: 3208 },
    },
    {
      name: 'teen-monitoring-dev',
      cwd: `${BASE}/monitoring-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('monitoring-service'), PORT: 3217 },
    },
    {
      name: 'teen-risk-dev',
      cwd: `${BASE}/risk-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('risk-service'), PORT: 3206 },
    },
    {
      name: 'teen-churn-dev',
      cwd: `${BASE}/churn-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('churn-service'), PORT: 3213 },
    },
    {
      name: 'teen-churn-ml-dev',
      cwd: `${BASE}/churn-ml-service`,
      script: 'venv/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port 3220',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      interpreter: 'none',
      env: { ...LOAD_ENV('churn-ml-service'), NODE_ENV: 'development' },
    },
    {
      name: 'teen-app-monitor-dev',
      cwd: `${BASE}/app-monitor-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('app-monitor-service'), PORT: 3215, GEOLITE2_CITY_PATH: '/opt/teen/geoip/GeoLite2-City.mmdb' },
    },
    {
      name: 'teen-uptime-bot-dev',
      cwd: `${BASE}/uptime-bot`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '100M',
      env: { ...NODE_OPTS, ...LOAD_ENV('uptime-bot'), UPTIME_STATUS_FILE: '/opt/teen/uptime-status-dev.json' },
    },
    {
      name: 'teen-bot-learning-dev',
      cwd: `${BASE}/bot-learning-service`,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '150M',
      env: { ...NODE_OPTS, ...LOAD_ENV('bot-learning-service') },
    },
  ]
}
"""
        
        sftp = client.open_sftp()
        f = sftp.open("/opt/teen/ecosystem.dev.config.js", "w")
        f.write(dev_config_content)
        f.close()
        sftp.close()
        print("ecosystem.dev.config.js written successfully.")
        
        # Now restart the dev PM2 stack using the new config
        dev_apps = [
            "teen-core-api-dev", "teen-wallet-dev", "teen-gateway-dev", 
            "teen-gateway-2-dev", "teen-gateway-3-dev", "teen-aviator-dev", 
            "teen-ludo-dev", "teen-tp-engine-dev", "teen-admin-svc-dev", 
            "teen-monitoring-dev", "teen-risk-dev", "teen-churn-dev", 
            "teen-churn-ml-dev", "teen-app-monitor-dev", "teen-uptime-bot-dev", 
            "teen-bot-learning-dev"
        ]
        
        print("Deleting existing dev apps...")
        for app in dev_apps:
            client.exec_command(f"pm2 delete {app} || true")
            
        print("Launching dev stack with new configuration...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen && pm2 start ecosystem.dev.config.js && pm2 save")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # Verify status of teen-admin-svc-dev
        print("\nChecking pm2 status...")
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
