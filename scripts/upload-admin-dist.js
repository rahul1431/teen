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

console.log('📦 Tarring admin-panel/dist...');
const localDist = path.join(__dirname, '../admin-panel/dist');
const localTar = '/tmp/admin-dist.tar.gz';

execSync(`tar -czf ${localTar} -C ${localDist} .`);
console.log('✅ Local tar created:', fs.statSync(localTar).size, 'bytes');

const conn = new Client();

conn.on('ready', () => {
  console.log('📡 SSH Connection Ready.');
  conn.sftp((err, sftp) => {
    if (err) throw err;
    console.log('📤 Uploading tar archive to VPS...');
    const remoteTar = '/tmp/admin-dist.tar.gz';
    
    sftp.fastPut(localTar, remoteTar, {}, (uploadErr) => {
      if (uploadErr) throw uploadErr;
      console.log('✅ Tar archive uploaded to VPS.');

      const remoteCmds = `
        mkdir -p /home/admin/web/game.myonlinejoker.com/public_html/admin/ && \\
        rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/* && \\
        tar -xzf ${remoteTar} -C /home/admin/web/game.myonlinejoker.com/public_html/admin/ && \\
        mkdir -p /opt/teen-prod/admin-panel/dist && \\
        rm -rf /opt/teen-prod/admin-panel/dist/* && \\
        tar -xzf ${remoteTar} -C /opt/teen-prod/admin-panel/dist/ && \\
        chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/ && \\
        rm -f ${remoteTar} && \\
        echo "ADMIN_DEPLOY_SUCCESS"
      `;

      conn.exec(remoteCmds, (execErr, stream) => {
        if (execErr) throw execErr;
        let stdout = '';
        let stderr = '';
        stream.on('data', d => stdout += d.toString());
        stream.stderr.on('data', d => stderr += d.toString());
        stream.on('close', (code) => {
          console.log('📋 VPS Extract Output:', stdout.trim());
          if (stderr) console.error('⚠️ Stderr:', stderr);
          console.log('🎉 Admin Panel assets successfully updated on VPS!');
          conn.end();
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ SSH Error:', err.message);
}).connect(VPS_CONFIG);
