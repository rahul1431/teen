const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const VPS_CONFIG = {
  host: process.env.VPS_HOST || '64.204.130.181',
  port: 22,
  username: process.env.VPS_USER || 'root',
  password: process.env.VPS_PASSWORD || '4sXWo02f4WkNm8fM'
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
    const remoteApk = '/home/admin/web/game.myonlinejoker.com/public_html/downloads/app-release.apk';
    
    sftp.fastPut(localApk, remoteApk, {}, (uploadErr) => {
      if (uploadErr) {
        console.error('❌ Upload Error:', uploadErr);
        conn.end();
        process.exit(1);
      }
      
      console.log('✅ APK successfully uploaded to VPS downloads directory!');
      
      // Ensure correct permissions and update database for force update
      const remoteCmds = `
        chown admin:admin ${remoteApk} && \\
        chmod 644 ${remoteApk} && \\
        echo "Updating app_versions table to ${versionName} (${versionCode})..." && \\
        docker exec teen_postgres psql -U teen -d teen_db -c "INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update) VALUES ('${versionName}', ${versionCode}, 'https://game.myonlinejoker.com/downloads/app-release.apk', 'Rummy: Bot enhancements with humanized profiles, avatars, and realistic turn pacing', true) ON CONFLICT (version_code) DO UPDATE SET version_name = EXCLUDED.version_name, download_url = EXCLUDED.download_url, release_notes = EXCLUDED.release_notes, force_update = EXCLUDED.force_update;" && \\
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
