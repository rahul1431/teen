import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Building missing services (uptime-bot and churn-ml-service)...")
        
        cmds = [
            # 1. Build uptime-bot
            "echo '=== Building uptime-bot ==='",
            "cd /opt/teen/services/uptime-bot && npm install && npm run build",
            
            # 2. Build churn-ml-service
            "echo '=== Building churn-ml-service ==='",
            "apt-get update && apt-get install -y python3-venv",
            "cd /opt/teen/services/churn-ml-service && rm -rf venv && python3 -m venv venv && ./venv/bin/pip install --upgrade pip && ./venv/bin/pip install -r requirements.txt",
            
            # 3. Restart PM2 for these services now that they are built
            "echo '=== Restarting PM2 for uptime-bot and churn-ml-service ==='",
            # Delete and start them using the correct config files
            "pm2 delete teen-uptime-bot || true",
            "pm2 delete teen-churn-ml || true",
            "pm2 delete teen-uptime-bot-dev || true",
            "pm2 delete teen-churn-ml-dev || true",
            "cd /opt/teen && pm2 start ecosystem.config.js",
            "cd /opt/teen && pm2 start ecosystem.dev.config.js",
            "pm2 save",
            "pm2 status"
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR / STDERR:")
                print(err.strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
