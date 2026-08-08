const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '64.204.130.181',
  port: 22,
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASSWORD || '4sXWo02f4WkNm8fM'
};

console.log('🚀 Starting Full Direct Codebase Sync & VPS Deployment...');
console.log(`📡 Target VPS: ${VPS_CONFIG.username}@${VPS_CONFIG.host}`);

const rootDir = path.join(__dirname, '..');
const localTar = '/tmp/teen-full-code.tar.gz';

console.log('📦 Archiving workspace codebase (excluding node_modules, .git, etc)...');
execSync(
  `tar --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude=".next" --exclude="mobile/build" --exclude=".cache" -czf ${localTar} -C ${rootDir} .`
);

const sizeMb = (fs.statSync(localTar).size / (1024 * 1024)).toFixed(2);
console.log(`✅ Local codebase archive created: ${sizeMb} MB`);

const conn = new Client();

conn.on('ready', () => {
  console.log('📡 SSH Connection Established.');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ SFTP Error:', err);
      conn.end();
      process.exit(1);
    }

    console.log('📤 Uploading codebase archive to VPS...');
    const remoteTar = '/tmp/teen-full-code.tar.gz';

    sftp.fastPut(localTar, remoteTar, {}, (uploadErr) => {
      if (uploadErr) {
        console.error('❌ Upload Error:', uploadErr);
        conn.end();
        process.exit(1);
      }

      console.log('✅ Codebase archive uploaded to VPS.');

      const remoteCmds = `
        mkdir -p /opt/teen-prod && \\
        tar -xzf ${remoteTar} -C /opt/teen-prod/ && \\
        rm -f ${remoteTar} && \\
        echo "=== Code sync finished. Running infra/deploy/go.sh ===" && \\
        cd /opt/teen-prod && bash infra/deploy/go.sh
      `;

      console.log('⚙️ Unpacking code & executing infra/deploy/go.sh on VPS...');
      conn.exec(remoteCmds, (execErr, stream) => {
        if (execErr) {
          console.error('❌ Remote Exec Error:', execErr);
          conn.end();
          process.exit(1);
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', data => {
          const str = data.toString();
          stdout += str;
          process.stdout.write(str);
        });

        stream.stderr.on('data', data => {
          const str = data.toString();
          stderr += str;
          process.stderr.write(str);
        });

        stream.on('close', (code) => {
          console.log(`\n📋 Deployment process finished with exit code ${code}.`);
          conn.end();
          if (code === 0) {
            console.log('🎉 VPS FULL CODEBASE DEPLOYMENT SUCCESSFUL!');
          } else {
            console.error('⚠️ VPS Deployment finished with warnings or errors.');
          }
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ SSH Connection Error:', err.message);
  process.exit(1);
}).connect(VPS_CONFIG);
