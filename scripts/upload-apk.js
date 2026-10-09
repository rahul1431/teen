const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '64.204.130.181',
  port: 22,
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASSWORD || '4sXWo02f4WkNm8fM',
  keepaliveInterval: 0,
  readyTimeout: 60000
};

let localApk = path.join(__dirname, '../mobile/build/app/outputs/flutter-apk/app-release.apk');
const rootApk = path.join(__dirname, '../app-release.apk');
const pubspecPath = path.join(__dirname, '../mobile/pubspec.yaml');

if (fs.existsSync(localApk)) {
  // Sync to root app-release.apk as well
  try {
    fs.copyFileSync(localApk, rootApk);
    console.log(`📦 Synced fresh build from mobile/build to root app-release.apk`);
  } catch (_) {}
} else if (fs.existsSync(rootApk)) {
  localApk = rootApk;
} else {
  console.error(`❌ Local APK not found at ${localApk} or ${rootApk}. Run flutter build apk --release first.`);
  process.exit(1);
}

// Dynamically extract version info from pubspec.yaml
let versionName = '1.3.37';
let versionCode = 4229;
try {
  const pubspecContent = fs.readFileSync(pubspecPath, 'utf8');
  const match = pubspecContent.match(/^version:\s*([^\s+]+)\+(\d+)/m);
  if (match) {
    versionName = match[1];
    versionCode = parseInt(match[2], 10);
    console.log(`ℹ️ Parsed version: ${versionName}+${versionCode} from pubspec.yaml`);
  } else {
    console.warn(`⚠️ Could not parse version from pubspec.yaml. Defaulting to ${versionName}+${versionCode}`);
  }
} catch (err) {
  console.warn(`⚠️ Error reading pubspec.yaml: ${err.message}. Defaulting to ${versionName}+${versionCode}`);
}

const conn = new Client();

conn.on('ready', () => {
  console.log('📡 SSH Connection Ready.');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('❌ SFTP Init Error:', err);
      conn.end();
      process.exit(1);
    }
    
    console.log('📤 Uploading APK to VPS downloads directory...');
    const remoteApk = '/opt/teen-prod/downloads/app-release.apk';
    
    const fastPutOptions = {
      chunkSize: 32768,
      concurrency: 16,
      step: (total_transferred, chunk, total) => {
        const percent = ((total_transferred / total) * 100).toFixed(1);
        const curTen = Math.floor(total_transferred / total * 10);
        if (curTen !== lastPercent) {
          lastPercent = curTen;
          console.log(`⏳ Upload Progress: ${percent}% (${(total_transferred / (1024 * 1024)).toFixed(1)} MB / ${(total / (1024 * 1024)).toFixed(1)} MB)`);
        }
      }
    };
    let lastPercent = -1;

    sftp.fastPut(localApk, remoteApk, fastPutOptions, (uploadErr) => {
      if (uploadErr) {
        console.error('❌ Upload Error:', uploadErr);
        conn.end();
        process.exit(1);
      }
      
      console.log('✅ APK successfully uploaded to VPS downloads directory!');
      
      // Ensure correct permissions, create symlink, and update database for force update
      const remoteCmds = `
        chown admin:admin ${remoteApk} && \\
        chmod 644 ${remoteApk} && \\
        ln -sf app-release.apk /opt/teen-prod/downloads/app-release-${versionCode}.apk && \\
        echo "Updating app_versions table to ${versionName} (${versionCode})..." && \\
        (PGPASSWORD='teen_secret_2024' psql -U teen -h localhost -d teen_db -c "INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update) VALUES ('${versionName}', ${versionCode}, 'https://game.myonlinejoker.com/downloads/app-release.apk', 'Satta Matka: New clean Date Chart & weekly Panel Matrix, Color Prediction live trends and bet history sync', true) ON CONFLICT (version_code) DO UPDATE SET version_name = EXCLUDED.version_name, download_url = EXCLUDED.download_url, release_notes = EXCLUDED.release_notes, force_update = EXCLUDED.force_update;" || docker exec teen_postgres psql -U teen -d teen_db -c "INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update) VALUES ('${versionName}', ${versionCode}, 'https://game.myonlinejoker.com/downloads/app-release.apk', 'Satta Matka: New clean Date Chart & weekly Panel Matrix, Color Prediction live trends and bet history sync', true) ON CONFLICT (version_code) DO UPDATE SET version_name = EXCLUDED.version_name, download_url = EXCLUDED.download_url, release_notes = EXCLUDED.release_notes, force_update = EXCLUDED.force_update;") && \\
        echo "FORCE_UPDATE_DATABASE_SUCCESS"
      `;

      
      console.log('⚙️ Updating database record for force update...');
      conn.exec(remoteCmds, (execErr, stream) => {
        if (execErr) {
          console.error('❌ Remote Exec Error:', execErr);
          conn.end();
          process.exit(1);
        }
        
        let stdout = '';
        let stderr = '';
        stream.on('data', d => stdout += d.toString());
        stream.stderr.on('data', d => stderr += d.toString());
        stream.on('close', (code) => {
          console.log('📋 VPS Script Output:', stdout.trim());
          if (stderr) console.error('⚠️ Stderr:', stderr);
          console.log('🎉 Force update configuration completed successfully!');
          conn.end();
        });
      });
    });
  });
}).on('error', (err) => {
  console.error('❌ SSH Error:', err.message);
}).connect(VPS_CONFIG);
