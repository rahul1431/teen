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
        print("Connected to VPS. Fetching PM2 logs for teen-admin-svc-dev...")
        
        stdin, stdout, stderr = client.exec_command("pm2 logs teen-admin-svc-dev --lines 100 --no-color --raw --nostream")
        print(stdout.read().decode('utf-8', errors='replace'))
        print(stderr.read().decode('utf-8', errors='replace'))
        
        print("Checking general pm2 status for restarted apps...")
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print(stdout.read().decode('utf-8', errors='replace'))
        
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
