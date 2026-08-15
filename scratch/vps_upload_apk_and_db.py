import paramiko
import sys
import re
import os

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

local_apk_path = r"c:\Users\Rahul\Desktop\teen\mobile\build\app\outputs\flutter-apk\app-release.apk"
remote_apk_path = "/home/admin/web/game.myonlinejoker.com/public_html/downloads/app-release.apk"

if not os.path.exists(local_apk_path):
    print(f"Error: Local APK not found at {local_apk_path}")
    sys.exit(1)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=pw)

print("Connected to VPS. Uploading APK...")
sftp = client.open_sftp()

# Ensure remote downloads directory exists
try:
    sftp.mkdir("/home/admin/web/game.myonlinejoker.com/public_html/downloads")
    print("Created downloads directory")
except IOError:
    pass  # Already exists

sftp.put(local_apk_path, remote_apk_path)
print("APK uploaded successfully.")

# Read .env to get the real DB URL
env_content = sftp.open("/opt/teen-prod/services/admin-service/.env").read().decode('utf-8')
db_url_match = re.search(r"DATABASE_URL=(.+)", env_content)
if db_url_match:
    db_url = db_url_match.group(1).strip()
else:
    print("DB URL not found")
    sys.exit(1)

sftp.close()

# Node script to insert/update the app_versions table
node_script = f"""
const {{ Client }} = require('pg');
const client = new Client({{ connectionString: '{db_url}' }});
client.connect().then(() => {{
    return client.query(`
        INSERT INTO app_versions (version_name, version_code, download_url, release_notes, force_update)
        VALUES ('1.3.29', 4221, 'https://game.myonlinejoker.com/downloads/app-release.apk', 'Daily Lottery Removal & Kalyan Panel Chart UI Redesign', true)
        ON CONFLICT (version_code) DO UPDATE SET
          version_name = EXCLUDED.version_name,
          download_url = EXCLUDED.download_url,
          release_notes = EXCLUDED.release_notes,
          force_update = EXCLUDED.force_update;
    `);
}}).then(res => {{
    console.log("Database updated successfully:", res.rowCount, "rows affected.");
    process.exit(0);
}}).catch(err => {{
    console.error("Database update failed:", err);
    process.exit(1);
}});
"""

print("Updating database app_versions table...")
stdin, stdout, stderr = client.exec_command(f"cd /opt/teen-prod && node -e \"{node_script.replace('\"', '\\\"').replace('`', '\\`')}\"")
print(stdout.read().decode('utf-8'))
print(stderr.read().decode('utf-8'))

# Clean local item copy if required
print("Done!")
client.close()
