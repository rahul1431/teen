const https = require('https');
const { Client } = require('ssh2');
const fs = require('fs');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || (fs.existsSync('github_token.txt') ? fs.readFileSync('github_token.txt', 'utf8').trim() : '');
const VERSION_CODE = 4295;
const VERSION_NAME = '1.3.100';

function getLatestRun() {
  return new Promise((resolve) => {
    const req = https.get('https://api.github.com/repos/rahul1431/teen/actions/runs?per_page=5', {
      headers: {
        'User-Agent': 'Node-Deploy-Script',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const runs = json.workflow_runs || [];
          resolve(runs);
        } catch (e) {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
  });
}

function pollRun(runId) {
  return new Promise((resolve) => {
    const req = https.get(`https://api.github.com/repos/rahul1431/teen/actions/runs/${runId}`, {
      headers: {
        'User-Agent': 'Node-Deploy-Script',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ status: 'in_progress', conclusion: null }); }
      });
    });
    req.on('error', () => resolve({ status: 'in_progress', conclusion: null }));
  });
}

function getArtifacts(runId) {
  return new Promise((resolve) => {
    const req = https.get(`https://api.github.com/repos/rahul1431/teen/actions/runs/${runId}/artifacts`, {
      headers: {
        'User-Agent': 'Node-Deploy-Script',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).artifacts || []); }
        catch (e) { resolve([]); }
      });
    });
    req.on('error', () => resolve([]));
  });
}

async function main() {
  console.log(`🔍 Finding latest GitHub Actions workflow run for branch claude/confident-archimedes-e2dd1k...`);
  let runs = await getLatestRun();
  let targetRun = runs.find(r => r.head_branch === 'claude/confident-archimedes-e2dd1k');
  
  if (!targetRun) {
    console.log('No run found immediately, waiting 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
    runs = await getLatestRun();
    targetRun = runs.find(r => r.head_branch === 'claude/confident-archimedes-e2dd1k');
  }

  if (!targetRun) {
    console.error('Could not find active run. Exiting.');
    process.exit(1);
  }

  const runId = targetRun.id;
  console.log(`🚀 Found active run ID: ${runId} (${targetRun.name}) | Commit: ${targetRun.head_sha.slice(0, 7)}`);
  console.log(`🔄 Polling GitHub Actions run ${runId} (Build Flutter APK - ${VERSION_NAME}+${VERSION_CODE})...`);

  while (true) {
    const run = await pollRun(runId);
    const time = new Date().toLocaleTimeString('en-IN');
    console.log(`[${time}] Status: ${run.status} | Conclusion: ${run.conclusion}`);
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Build finished with conclusion: ${run.conclusion}`);
      }
      break;
    }
    await new Promise(r => setTimeout(r, 15000));
  }

  console.log('📦 Fetching artifacts list...');
  let artifacts = [];
  while (artifacts.length === 0) {
    artifacts = await getArtifacts(runId);
    if (artifacts.length === 0) await new Promise(r => setTimeout(r, 5000));
  }

  const artifact = artifacts.find(a => a.name.startsWith('release-apks'));
  if (!artifact) throw new Error('No release-apks artifact found!');

  console.log(`🚀 Artifact found: ${artifact.name} (${artifact.id}). Connecting to GCP VM...`);
  const conn = new Client();
  conn.on('ready', () => {
    console.log('✅ Connected to GCP VM. Pulling artifact & deploying...');
    const cmd = `
      set -e
      echo "1. Downloading artifact ZIP directly to GCP..."
      curl -L -s -H "Accept: application/vnd.github.v3+json" \\
        -H "Authorization: Bearer ${GITHUB_TOKEN}" \\
        -o /tmp/apks-${VERSION_CODE}.zip \\
        "${artifact.archive_download_url}"

      echo "2. Unzipping..."
      mkdir -p /tmp/apk-extract-${VERSION_CODE}
      unzip -q -o /tmp/apks-${VERSION_CODE}.zip -d /tmp/apk-extract-${VERSION_CODE}
      ls -lh /tmp/apk-extract-${VERSION_CODE}

      echo "3. Verifying Player and Agent APK parity..."
      if cmp -s /tmp/apk-extract-${VERSION_CODE}/app-release.apk /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk; then
        echo "❌ FATAL ERROR: app-release.apk and agent-partner-release.apk are IDENTICAL files!"
        exit 1
      fi
      echo "✅ Verified: app-release.apk (Player) and agent-partner-release.apk (Agent) are distinct!"

      echo "4. Copying APKs to downloads & docroot..."
      DEST="/home/admin/web/game.myonlinejoker.com/public_html/downloads"
      sudo mkdir -p $DEST
      sudo mkdir -p /opt/teen-prod/downloads

      # Agent Partner APK
      if [ -f /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk ]; then
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk $DEST/agent-partner-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk /opt/teen-prod/downloads/agent-partner-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk $DEST/agent-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk /opt/teen-prod/downloads/agent-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk $DEST/teen-agent.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/agent-partner-release.apk /opt/teen-prod/downloads/teen-agent.apk
        sudo chmod 644 $DEST/agent* /opt/teen-prod/downloads/agent* $DEST/teen-agent.apk /opt/teen-prod/downloads/teen-agent.apk
        echo "✅ Copied agent-partner-release.apk and aliases"
      fi

      # Universal Player APK
      if [ -f /tmp/apk-extract-${VERSION_CODE}/app-release.apk ]; then
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-release.apk $DEST/app-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-release.apk /opt/teen-prod/downloads/app-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-release.apk $DEST/teen-patti.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-release.apk /opt/teen-prod/downloads/teen-patti.apk
        sudo chmod 644 $DEST/app-release.apk /opt/teen-prod/downloads/app-release.apk $DEST/teen-patti.apk /opt/teen-prod/downloads/teen-patti.apk
        echo "✅ Copied universal Player app-release.apk and teen-patti.apk"
      fi

      # Split per-ABI APKs
      if [ -f /tmp/apk-extract-${VERSION_CODE}/app-arm64-v8a-release.apk ]; then
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-arm64-v8a-release.apk $DEST/app-arm64-v8a-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-arm64-v8a-release.apk /opt/teen-prod/downloads/app-arm64-v8a-release.apk
        sudo chmod 644 $DEST/app-arm64-v8a-release.apk /opt/teen-prod/downloads/app-arm64-v8a-release.apk
        echo "✅ Copied app-arm64-v8a-release.apk"
      fi
      if [ -f /tmp/apk-extract-${VERSION_CODE}/app-armeabi-v7a-release.apk ]; then
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-armeabi-v7a-release.apk $DEST/app-armeabi-v7a-release.apk
        sudo cp /tmp/apk-extract-${VERSION_CODE}/app-armeabi-v7a-release.apk /opt/teen-prod/downloads/app-armeabi-v7a-release.apk
        sudo chmod 644 $DEST/app-armeabi-v7a-release.apk /opt/teen-prod/downloads/app-armeabi-v7a-release.apk
        echo "✅ Copied app-armeabi-v7a-release.apk"
      fi

      echo "5. Updating database app_versions..."
      sudo docker exec -i teen_postgres psql -U teen -d teen_db -c "
        INSERT INTO app_versions (version_code, version_name, download_url, release_notes, force_update)
        VALUES (${VERSION_CODE}, '${VERSION_NAME}', 'https://game.myonlinejoker.com/downloads/app-release.apk', 'MyOnlineJoker Player & Agent App with enterprise push notifications on closed apps, multi-channel alerts & dynamic personalization', true)
        ON CONFLICT (version_code) DO UPDATE
        SET version_name = '${VERSION_NAME}', download_url = 'https://game.myonlinejoker.com/downloads/app-release.apk', force_update = true;
        SELECT version_code, version_name, force_update, created_at FROM app_versions ORDER BY version_code DESC LIMIT 3;
      "

      echo "6. Updating download landing page copy..."
      sudo sed -i 's/v1.3.9[0-9]/v${VERSION_NAME}/g' /opt/teen-prod/infra/web/download/index.html /home/admin/web/game.myonlinejoker.com/public_html/download/index.html || true
      sudo nginx -t && sudo systemctl reload nginx

      echo "7. Cleaning up temp files..."
      rm -rf /tmp/apks-${VERSION_CODE}.zip /tmp/apk-extract-${VERSION_CODE}
      echo "🎉 ALL DONE! Build ${VERSION_CODE} (${VERSION_NAME}) deployed and live!"
    `;

    conn.exec(cmd, (err, stream) => {
      if (err) throw err;
      stream.on('data', d => process.stdout.write(d));
      stream.on('close', (code) => {
        conn.end();
        if (code === 0) {
          console.log('\n✅ Deployment finished successfully!');
        } else {
          console.error(`\n❌ Deployment script exited with code ${code}`);
          process.exit(code);
        }
      });
    });
  }).connect({
    host: '35.244.3.210',
    username: 'rahulrathodloan3l',
    privateKey: fs.readFileSync('C:/Users/Rahul/.ssh/id_ed25519')
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
