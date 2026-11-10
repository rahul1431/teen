const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const filesToUpload = [
  {
    local: 'services/admin-service/src/helpers/alist-client.ts',
    remote: '/opt/teen-prod/services/admin-service/src/helpers/alist-client.ts'
  },
  {
    local: 'services/admin-service/src/agent-portal-routes.ts',
    remote: '/opt/teen-prod/services/admin-service/src/agent-portal-routes.ts'
  },
  {
    local: 'services/admin-service/src/agent-routes.ts',
    remote: '/opt/teen-prod/services/admin-service/src/agent-routes.ts'
  },
  {
    local: 'services/core-api-service/src/helpers/alist-client.ts',
    remote: '/opt/teen-prod/services/core-api-service/src/helpers/alist-client.ts'
  }
];

const conn = new Client();
conn.on('ready', () => {
  console.log('📡 Connected to GCP. Starting file uploads...');
  conn.sftp((err, sftp) => {
    if (err) throw err;

    let index = 0;
    function uploadNext() {
      if (index >= filesToUpload.length) {
        console.log('✅ All files uploaded. Building and reloading PM2...');
        const cmd = `
          cd /opt/teen-prod/services/admin-service && npm run build && pm2 reload teen-admin-svc && \\
          cd /opt/teen-prod/services/core-api-service && npm run build && pm2 reload teen-core-api && \\
          echo "ALL_SERVICES_DEPLOYED_SUCCESSFULLY"
        `;
        conn.exec(cmd, (execErr, stream) => {
          if (execErr) throw execErr;
          let stdout = '';
          let stderr = '';
          stream.on('data', d => stdout += d.toString());
          stream.stderr.on('data', d => stderr += d.toString());
          stream.on('close', (code) => {
            console.log(stdout);
            if (stderr) console.error(stderr);
            console.log('Exit code:', code);
            conn.end();
          });
        });
        return;
      }

      const item = filesToUpload[index];
      console.log(`Uploading ${item.local} -> ${item.remote}...`);
      sftp.fastPut(item.local, item.remote, {}, (upErr) => {
        if (upErr) throw upErr;
        console.log(`✓ Uploaded ${item.local}`);
        index++;
        uploadNext();
      });
    }

    uploadNext();
  });
}).connect({
  host: '35.244.3.210',
  port: 22,
  username: 'rahulrathodloan3l',
  privateKey: fs.readFileSync('C:/Users/Rahul/.ssh/id_ed25519')
});

