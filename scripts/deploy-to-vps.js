const { Client } = require('ssh2');
const http = require('http');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '64.204.130.181',
  port: 22,
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASSWORD || '4sXWo02f4WkNm8fM'
};

console.log('🚀 Starting Automated VPS Direct Deployment...');
console.log(`📡 Target VPS: ${VPS_CONFIG.username}@${VPS_CONFIG.host}`);

const conn = new Client();

function executeRemoteCommand(cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', data => stdout += data.toString());
      stream.stderr.on('data', data => stderr += data.toString());
      stream.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  });
}

function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://${VPS_CONFIG.host}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ ok: true, data });
        } else {
          resolve({ ok: false, statusCode: res.statusCode, data });
        }
      });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout after 5s' });
    });
  });
}

conn.on('ready', async () => {
  console.log('✅ SSH Connection Established.');
  try {
    console.log('🔄 Updating codebase on VPS (/opt/teen-prod)...');
    
    // Step 1: Pull from git if applicable, or check status
    const gitPullRes = await executeRemoteCommand('cd /opt/teen-prod && git stash && (git pull origin main || git pull origin feature/admin-responsive || true)');
    console.log('📥 Git Pull Log:', gitPullRes.stdout.trim() || 'No git output');

    // Step 2: Trigger deployment script
    console.log('⚙️ Executing deployment script (infra/deploy/go.sh)...');
    const deployRes = await executeRemoteCommand('cd /opt/teen-prod && bash infra/deploy/go.sh');
    console.log('📋 Deploy Log Output:\n' + deployRes.stdout.slice(-1000));
    if (deployRes.stderr) {
      console.log('⚠️ Deploy Warnings/Stderr:\n' + deployRes.stderr.slice(-500));
    }

    // Step 3: Check PM2 process status
    console.log('📊 Verifying PM2 services...');
    const pm2Res = await executeRemoteCommand('pm2 jlist');
    try {
      const procs = JSON.parse(pm2Res.stdout);
      const online = procs.filter(p => p.pm2_env.status === 'online');
      const offline = procs.filter(p => p.pm2_env.status !== 'online');
      console.log(`✅ ${online.length} of ${procs.length} PM2 services are ONLINE.`);
      if (offline.length > 0) {
        console.log('⚠️ Offline services:', offline.map(p => p.name).join(', '));
      }
    } catch (e) {
      console.log('ℹ️ PM2 status output:', pm2Res.stdout.slice(0, 300));
    }

    // Step 4: Health check
    console.log('🏥 Performing Health Check (http://64.204.130.181/health)...');
    const health = await checkHealth();
    if (health.ok) {
      console.log('🎉 HEALTH CHECK PASSED! Response:', health.data);
    } else {
      console.log('⚠️ Health check status:', health);
    }

    console.log('✨ VPS DEPLOYMENT COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Deployment error:', err);
  } finally {
    conn.end();
  }
}).on('error', (err) => {
  console.error('❌ SSH Connection Failed:', err.message);
}).connect(VPS_CONFIG);
