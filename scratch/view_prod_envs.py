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
            "app-monitor-service",
            "bot-learning-service"
        ]
        
        for svc in services:
            print("="*60)
            print(f"SERVICE: {svc}")
            print("="*60)
            cmd = f"cat /opt/teen/services/{svc}/.env"
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            for line in out.split("\n"):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    # Mask potential secrets, show only key and length/type or non-secrets
                    if any(x in k.lower() for x in ["secret", "password", "key", "token", "url", "db", "port", "host"]):
                        # Keep host/port/url visible but mask sensitive parts
                        if "url" in k.lower() or "host" in k.lower() or "port" in k.lower():
                            print(f"{k}={v}")
                        else:
                            print(f"{k}=[MASKED (len={len(v)})]")
                    else:
                        print(f"{k}={v}")
            print()

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
