import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def check_logs():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Fetching PM2 logs...")
        stdin, stdout, stderr = client.exec_command("cat /root/.pm2/logs/teen-core-api-out-0.log | tail -n 100")
        print("=== STDOUT ===")
        print(stdout.read().decode('utf-8', errors='replace'))
        print("=== STDERR ===")
        print(stderr.read().decode('utf-8', errors='replace'))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    check_logs()
