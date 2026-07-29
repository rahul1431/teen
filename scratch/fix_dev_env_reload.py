import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run(client, cmd, timeout=30):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)

        # Upload the fixed ecosystem config
        sftp = client.open_sftp()
        sftp.put("ecosystem.config.dev.js", "/opt/teen-dev/ecosystem.config.dev.js")
        sftp.close()
        print("Uploaded ecosystem.config.dev.js to /opt/teen-dev/")

        # Reload PM2 with the new config (--update-env to pick up new env vars)
        print("\nReloading PM2 with updated ecosystem.config.dev.js ...")
        out, err = run(client, "cd /opt/teen-dev && pm2 reload ecosystem.config.dev.js --update-env 2>&1", timeout=60)
        print(out[-2000:] if len(out) > 2000 else out)
        if err:
            print("STDERR:", err[:500])

        # Wait a moment then test login
        import time
        time.sleep(5)
        print("\nTesting login on DEV admin-service (port 3208) ...")
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        print("Login response:", out[:300])

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
