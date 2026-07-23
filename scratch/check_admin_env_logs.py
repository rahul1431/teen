import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run(client, cmd, timeout=15):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        
        # Check .env.dev for admin service
        print("=== .env.dev of admin-service on DEV ===")
        out, _ = run(client, "cat /opt/teen-dev/services/admin-service/.env.dev")
        print(out)
        
        # Check PM2 logs for dev admin svc
        print("\n=== PM2 last 30 lines of teen-admin-svc-dev ===")
        out, _ = run(client, "pm2 logs teen-admin-svc-dev --lines 30 --nostream 2>&1 | tail -30")
        print(out)
        
        # Check PM2 logs for prod admin svc  
        print("\n=== PM2 last 10 lines of teen-admin-svc ===")
        out, _ = run(client, "pm2 logs teen-admin-svc --lines 10 --nostream 2>&1 | tail -10")
        print(out)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
