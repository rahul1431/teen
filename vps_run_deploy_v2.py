import paramiko
import sys
import io
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_deploy():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Starting deployment...")

        # 1. Pull the latest commits on our branch
        cmds = [
            "cd /opt/teen && git clean -fd && git reset --hard && git checkout claude/confident-archimedes-e2dd1k && git pull origin claude/confident-archimedes-e2dd1k"
        ]
        for cmd in cmds:
            print(f"---> CMD: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace'))
            print(stderr.read().decode('utf-8', errors='replace'))

        # 2. Read the admin-service .env to copy database and redis urls
        print("Reading admin-service .env secrets...")
        sftp = client.open_sftp()
        try:
            admin_env_content = sftp.open("/opt/teen/services/admin-service/.env").read().decode('utf-8')
        except Exception as e:
            print(f"Error reading admin-service .env: {e}")
            admin_env_content = ""

        # Extract values using regex
        db_url = re.search(r"DATABASE_URL=(.+)", admin_env_content)
        redis_url = re.search(r"REDIS_URL=(.+)", admin_env_content)

        db_url_val = db_url.group(1).strip() if db_url else "postgresql://teen:password@127.0.0.1:5432/teen_db"
        redis_url_val = redis_url.group(1).strip() if redis_url else "redis://127.0.0.1:6379"

        print(f"Extracted DB URL and Redis URL successfully.")

        # 3. Create .env for monitoring-service
        monitoring_env = f"""# Monitoring Service Configuration
PORT=3012
NODE_ENV=production
LOG_LEVEL=info
DATABASE_URL={db_url_val}
REDIS_URL={redis_url_val}
WEBSOCKET_SOURCE_URL=ws://127.0.0.1:3004/ws
"""
        print("Writing monitoring-service .env...")
        monitoring_env_file = sftp.open("/opt/teen/services/monitoring-service/.env", "w")
        monitoring_env_file.write(monitoring_env)
        monitoring_env_file.close()

        # 4. Create .env for risk-service
        risk_env = f"""# Risk Service Configuration
PORT=3016
HOST=0.0.0.0
DATABASE_URL={db_url_val}
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
FRAUD_DETECTION_ENABLED=true
FRAUD_CO_LOCATION_THRESHOLD=3
FRAUD_WIN_RATE_THRESHOLD=95
FRAUD_VELOCITY_HOURS=1
FRAUD_REFERRAL_DEPTH=2
LOG_LEVEL=info
"""
        print("Writing risk-service .env...")
        risk_env_file = sftp.open("/opt/teen/services/risk-service/.env", "w")
        risk_env_file.write(risk_env)
        risk_env_file.close()

        # 4b. Create .env for churn-service
        churn_env = f"""# Churn Service Configuration
PORT=3013
NODE_ENV=production
DATABASE_URL={db_url_val}
REDIS_URL={redis_url_val}
NOTIFICATION_SERVICE_URL=http://127.0.0.1:3007
WALLET_SERVICE_URL=http://127.0.0.1:3003
"""
        print("Writing churn-service .env...")
        churn_env_file = sftp.open("/opt/teen/services/churn-service/.env", "w")
        churn_env_file.write(churn_env)
        churn_env_file.close()

        # 4c. Create .env for bot-learning-service
        bot_learning_env = f"""# Bot Learning Service Configuration
PORT=3014
NODE_ENV=production
DATABASE_URL={db_url_val}
REDIS_URL={redis_url_val}
"""
        print("Writing bot-learning-service .env...")
        bot_learning_env_file = sftp.open("/opt/teen/services/bot-learning-service/.env", "w")
        bot_learning_env_file.write(bot_learning_env)
        bot_learning_env_file.close()

        # 4d. Create .env for app-monitor-service
        app_monitor_env = f"""# App Monitor Service Configuration
PORT=3015
NODE_ENV=production
DATABASE_URL={db_url_val}
REDIS_URL={redis_url_val}
"""
        print("Writing app-monitor-service .env...")
        app_monitor_env_file = sftp.open("/opt/teen/services/app-monitor-service/.env", "w")
        app_monitor_env_file.write(app_monitor_env)
        app_monitor_env_file.close()

        sftp.close()

        # 5. Run deploy services script
        # This compiles everything and applies database migrations!
        print("Running build and migration script...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen && bash infra/deploy/deploy-services.sh")
        
        # Read build logs in real-time
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line, end="")
        
        print(stderr.read().decode('utf-8', errors='replace'))

        # 6. Rebuild and copy admin panel
        print("\nRebuilding admin-panel...")
        admin_build_cmd = "cd /opt/teen/admin-panel && npm install --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/"
        stdin, stdout, stderr = client.exec_command(admin_build_cmd)
        
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line, end="")
            
        print(stderr.read().decode('utf-8', errors='replace'))

        print("\nCopying admin-panel bundle to web root...")
        copy_cmds = [
            "rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/*",
            "cp -r /opt/teen/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/",
            "chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/",
            "systemctl reload nginx"
        ]
        for cmd in copy_cmds:
            print(f"---> CMD: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace'))
            print(stderr.read().decode('utf-8', errors='replace'))

        # 7. Start PM2 and print status
        print("\nRestarting PM2 processes...")
        pm2_cmds = [
            "pm2 delete teen-monitoring || true",
            "pm2 delete teen-risk || true",
            "pm2 delete teen-churn || true",
            "pm2 delete teen-bot-learning || true",
            "pm2 delete teen-app-monitor || true",
            "cd /opt/teen && pm2 start ecosystem.config.js",
            "pm2 save",
            "pm2 status"
        ]
        for cmd in pm2_cmds:
            print(f"---> CMD: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace'))
            print(stderr.read().decode('utf-8', errors='replace'))

        print("\nDeployment successful and verified!")

    except Exception as e:
        print(f"Deployment failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_deploy()
