const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '35.244.3.210',
  port: 22,
  username: process.env.VPS_USER || 'rahulrathodloan3l',
  privateKey: fs.existsSync('C:/Users/Rahul/.ssh/id_ed25519') ? fs.readFileSync('C:/Users/Rahul/.ssh/id_ed25519') : undefined
};

console.log('📦 Tarring admin-panel/dist for GCP VM...');
const localDist = path.join(__dirname, '../admin-panel/dist');
const localTar = path.join(os.tmpdir(), 'admin-dist.tar.gz');

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
        mkdir -p /opt/teen-prod/admin-panel/dist && \\
        rm -rf /opt/teen-prod/admin-panel/dist/* && \\
        tar -xzf ${remoteTar} -C /opt/teen-prod/admin-panel/dist/ && \\
        (if [ -d /home/admin/web/game.myonlinejoker.com/public_html/admin ]; then sudo cp -r /opt/teen-prod/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/; fi) && \\
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
