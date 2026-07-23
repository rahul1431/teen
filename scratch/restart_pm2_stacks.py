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
        print("Connected to VPS. Running Steps 3 & 4: Restarting PM2 process stacks...")
        
        # 1. Stop and delete dev services (both old name and new name formats just to be safe)
        dev_apps_to_delete = [
            "teen-core-api-dev", "teen-wallet-dev", "teen-gateway-dev", 
            "teen-gateway-2-dev", "teen-gateway-3-dev", "teen-aviator-dev", 
            "teen-ludo-dev", "teen-tp-engine-dev", "teen-admin-svc-dev", 
            "teen-monitoring-dev", "teen-risk-dev", "teen-churn-dev", 
            "teen-churn-ml-dev", "teen-app-monitor-dev", "teen-uptime-bot-dev", 
            "teen-bot-learning-dev"
        ]
        
        # 2. Stop and delete errored prod services so we can start them fresh
        prod_apps_to_delete = [
            "teen-admin-svc", "teen-wallet"
        ]
        
        all_delete_cmds = []
        for app in dev_apps_to_delete + prod_apps_to_delete:
            all_delete_cmds.append(f"pm2 delete {app} || true")
            
        for cmd in all_delete_cmds:
            client.exec_command(cmd)
            
        print("Old PM2 processes cleared.")
        
        # 3. Start dev stack using ecosystem.config.dev.js
        print("Starting development stack...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen && pm2 start ecosystem.config.dev.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # 4. Start/Restart prod stack using ecosystem.config.js
        # To make sure we launch the missing production services as well, we start ecosystem.config.js.
        # PM2 will launch any app defined in the file that isn't already running.
        print("Starting/restoring production stack...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen && pm2 start ecosystem.config.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # 5. Save the configuration
        print("Saving PM2 configuration...")
        stdin, stdout, stderr = client.exec_command("pm2 save")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # 6. Check final status
        print("Final PM2 Status:")
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        print("\nSteps 3 & 4 completed successfully.")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
