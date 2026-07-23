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
        print("Connected to VPS. Modifying REDIS_URL in .env.dev files to include password...")
        
        # We'll use a bash command to find and replace the REDIS_URL line in all .env.dev files on the VPS
        replace_cmd = (
            "find /opt/teen/services/ -name '.env.dev' -type f -exec "
            "sed -i 's|REDIS_URL=redis://localhost:6380|REDIS_URL=redis://:teen_redis_dev_2024@localhost:6380|g' {} +"
        )
        
        print(f"Executing: {replace_cmd}")
        stdin, stdout, stderr = client.exec_command(replace_cmd)
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # Let's verify by catting one of them
        stdin, stdout, stderr = client.exec_command("cat /opt/teen/services/admin-service/.env.dev")
        print("Updated .env.dev for admin-service:")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # Now restart the dev PM2 processes to apply the changes
        dev_apps = [
            "teen-core-api-dev", "teen-wallet-dev", "teen-gateway-dev", 
            "teen-gateway-2-dev", "teen-gateway-3-dev", "teen-aviator-dev", 
            "teen-ludo-dev", "teen-tp-engine-dev", "teen-admin-svc-dev", 
            "teen-monitoring-dev", "teen-risk-dev", "teen-churn-dev", 
            "teen-churn-ml-dev", "teen-app-monitor-dev", "teen-uptime-bot-dev", 
            "teen-bot-learning-dev"
        ]
        
        print("\nDeleting PM2 processes to ensure clean environment reload...")
        for app in dev_apps:
            client.exec_command(f"pm2 delete {app} || true")
            
        print("Re-launching PM2 dev stack...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen && pm2 start ecosystem.dev.config.js && pm2 save")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # Wait a moment for startup and print PM2 status
        import time
        print("Waiting 5 seconds for services to initialize...")
        time.sleep(5)
        
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print("\nPM2 Status:")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
