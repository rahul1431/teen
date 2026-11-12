const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '35.244.3.210',
  port: 22,
  username: process.env.VPS_USER || 'rahulrathodloan3l',
  privateKey: fs.readFileSync('C:/Users/Rahul/.ssh/id_ed25519')
};

console.log('🚀 Starting Direct Codebase Sync to GCP VM...');
console.log(`📡 Target VM: ${VPS_CONFIG.username}@${VPS_CONFIG.host}`);

const rootDir = path.join(__dirname, '..');
const localTar = path.join(os.tmpdir(), 'teen-gcp-code.tar.gz');

console.log('📦 Archiving backend services, migrations, and scripts...');
execSync(
  `tar --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude="__pycache__" --exclude="venv" --exclude=".venv" --exclude=".pytest_cache" --exclude="teen-patti-engine" --exclude="*.log" -czf ${localTar} -C ${rootDir} services infra scripts ecosystem.config.js`
);

const sizeMb = (fs.statSync(localTar).size / (1024 * 1024)).toFixed(2);
console.log(`✅ Local archive created: ${sizeMb} MB`);

const conn = new Client();

conn.on('ready', () => {
  console.log('📡 SSH Connection Established.');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ SFTP Error:', err);
      conn.end();
      process.exit(1);
    }

    console.log('📤 Uploading archive to GCP VM...');
    const remoteTar = '/tmp/teen-gcp-code.tar.gz';

    sftp.fastPut(localTar, remoteTar, {}, (uploadErr) => {
      if (uploadErr) {
        console.error('❌ Upload Error:', uploadErr);
        conn.end();
        process.exit(1);
      }

      console.log('✅ Archive uploaded.');

      const remoteCmds = `
        tar -xzf ${remoteTar} -C /opt/teen-prod/ && \\
        rm -f ${remoteTar} && \\
        echo "=== Code unpacked. Building backend services & engines ===" && \\
        cd /opt/teen-prod/services/admin-service && npm run build && \\
        cd /opt/teen-prod/services/app-monitor-service && npm run build && \\
        cd /opt/teen-prod/services/core-api-service && npm run build && \\
        cd /opt/teen-prod/services/wallet-service && npm run build && \\
        cd /opt/teen-prod/services/game-gateway && npm run build && \\
        cd /opt/teen-prod/services/game-engines/ludo && npm run build && \\
        cd /opt/teen-prod/services/game-engines/rummy && npm run build && \\
        cd /opt/teen-prod/services/bot-training/teen-patti && npm run build && \\
        cd /opt/teen-prod/services/bot-training/ludo && npm run build && \\
        cd /opt/teen-prod/services/bot-training/rummy && (npm install --production=false || true) && npm run build && \\
        cd /opt/teen-prod/services/company-ops-agent && (npm install --production=false || true) && npm run build && \\
        cd /opt/teen-prod/services/monitoring-service && npm run build && \\
        cd /opt/teen-prod/services/game-engines/teen-patti && go build -o teen-patti-engine . && \\
        echo "=== Running Database Migration 111 (Row Level Security) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/111_enable_row_level_security.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 112 (Enterprise Notifications) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/112_enterprise_notifications.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 112 (YouPI Payment Gateway) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/112_youpi_payment_gateway.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 113 (Bot Cognitive Memory) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/113_bot_cognitive_memory.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 114 (Bot Self Play Training) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/114_bot_self_play_training.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 115 (Behavioral Cloning) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/115_behavioral_cloning.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 116 (Table Anti-Collusion) ===" && \\
        cat /opt/teen-prod/infra/db/migrations/116_table_anti_collusion.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db && \\
        echo "=== Running Database Migration 119 & 120 (Enterprise Notifications) ===" && \\
        (if [ -f /opt/teen-prod/infra/db/migrations/119_enterprise_notifications_phase2.sql ]; then cat /opt/teen-prod/infra/db/migrations/119_enterprise_notifications_phase2.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db; fi) && \\
        (if [ -f /opt/teen-prod/infra/db/migrations/120_enterprise_notifications_phase3.sql ]; then cat /opt/teen-prod/infra/db/migrations/120_enterprise_notifications_phase3.sql | sudo docker exec -i teen_postgres psql -U teen -d teen_db; fi) && \\
        echo "=== Updating Nginx Security Snippets and Configs ===" && \\
        (sudo cp /opt/teen-prod/infra/nginx/proxy-headers.conf /etc/nginx/snippets/proxy-headers.conf 2>/dev/null || true) && \\
        (sudo cp /opt/teen-prod/infra/nginx/game-locations.conf /etc/nginx/snippets/game-locations.conf 2>/dev/null || true) && \\
        (if [ -f /home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api ]; then sudo cp /opt/teen-prod/infra/nginx/hestia-proxy.conf /home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api && sudo cp /opt/teen-prod/infra/nginx/hestia-proxy.conf /home/admin/conf/web/game.myonlinejoker.com/nginx.conf_api; fi) && \\
        sudo bash -c 'echo "limit_req_zone \\$binary_remote_addr zone=auth_limit:10m rate=10r/s;" > /etc/nginx/conf.d/security_limits.conf' && \\
        sudo nginx -t && sudo systemctl reload nginx && \\
        echo "=== Reloading / Starting PM2 services with updated environment ===" && \\
        pm2 startOrReload /opt/teen-prod/ecosystem.config.js --update-env && \\
        pm2 save && \\
        echo "=== Deployment Completed! ==="
      `;

      console.log('⚙️ Executing build and restart on VM...');
      conn.exec(remoteCmds, (execErr, stream) => {
        if (execErr) {
          console.error('❌ Exec Error:', execErr);
          conn.end();
          process.exit(1);
        }

        stream.on('data', data => process.stdout.write(data.toString()));
        stream.stderr.on('data', data => process.stderr.write(data.toString()));

        stream.on('close', (code) => {
          console.log(`\n📋 Process finished with exit code ${code}.`);
          conn.end();
          try { fs.unlinkSync(localTar); } catch (_) {}
          if (code === 0) {
            console.log('🎉 GCP CODEBASE SYNC SUCCESSFUL!');
          }
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ SSH Error:', err.message);
  process.exit(1);
}).connect(VPS_CONFIG);
