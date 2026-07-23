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
        print("Connected to VPS. Checking latest teen-admin-svc-dev logs...")
        
        stdin, stdout, stderr = client.exec_command("pm2 logs teen-admin-svc-dev --lines 50 --no-color --raw --nostream")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        print("\nChecking system-wide pm2 status...")
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
