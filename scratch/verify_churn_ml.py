import paramiko
import json

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def check_churn_ml():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS via SSH...")

        # 1. Check health
        print("\nChecking /health of Churn ML Service...")
        stdin, stdout, stderr = client.exec_command("curl -s http://127.0.0.1:3020/health")
        out = stdout.read().decode('utf-8')
        print(f"Health Response: {out}")

        # 2. Trigger train
        print("\nTriggering Model Training /train...")
        stdin, stdout, stderr = client.exec_command("curl -s -X POST http://127.0.0.1:3020/train")
        out = stdout.read().decode('utf-8')
        print(f"Train Response: {out}")

        # 3. Check logs of teen-churn-ml
        print("\nChecking PM2 logs for teen-churn-ml...")
        stdin, stdout, stderr = client.exec_command("pm2 logs teen-churn-ml --lines 15 --raw --nostream")
        out = stdout.read().decode('utf-8')
        print(f"Logs:\n{out}")

        # 4. Check logs of teen-churn (Node.js service)
        print("\nChecking PM2 logs for teen-churn...")
        stdin, stdout, stderr = client.exec_command("pm2 logs teen-churn --lines 15 --raw --nostream")
        out = stdout.read().decode('utf-8')
        print(f"Logs:\n{out}")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    check_churn_ml()
