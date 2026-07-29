import paramiko
import sys
import io
import json
import time

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

        # Login
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        data = json.loads(out)
        token = data.get('token', '')

        # Test full response of /api/admin/dev/deployment-health
        print("=== /api/admin/dev/deployment-health ===")
        out2, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployment-health \
          -H 'Authorization: Bearer {token}'""", timeout=15)
        print(out2[:800])

        print("\n=== /api/admin/dev/deployments ===")
        out3, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployments \
          -H 'Authorization: Bearer {token}'""", timeout=15)
        print(out3[:800])

        print("\n=== List all /api/admin/dev/* routes (check server log) ===")
        # Try a route that likely exists
        out4, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/ \
          -H 'Authorization: Bearer {token}'""", timeout=10)
        print("Root:", out4[:300])

        # Check recent PM2 logs for errors
        print("\n=== teen-admin-svc-dev last 20 error lines ===")
        out5, _ = run(client, "pm2 logs teen-admin-svc-dev --err --lines 20 --nostream 2>&1")
        print(out5[-2000:])

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
