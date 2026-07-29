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
        
        services = [
            "core-api-service",
            "wallet-service",
            "admin-service",
            "game-gateway",
            "game-engines/aviator",
            "game-engines/ludo",
            "game-engines/teen-patti",
            "monitoring-service",
            "risk-service",
            "churn-service",
            "churn-ml-service",
            "app-monitor-service",
            "bot-learning-service"
        ]
        
        for svc in services:
            print("="*60)
            print(f"SERVICE: {svc}")
            print("="*60)
            
            # Check env files
            cmd = f"ls -l /opt/teen/services/{svc}/.env*"
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            print("Files:")
            print(out.strip() or "No env files found")
            
            # Read .env.dev if exists
            cmd_read = f"cat /opt/teen/services/{svc}/.env.dev || echo '.env.dev not found'"
            stdin, stdout, stderr = client.exec_command(cmd_read)
            out_read = stdout.read().decode('utf-8', errors='replace')
            print("Contents of .env.dev:")
            print(out_read.strip())
            print()

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
