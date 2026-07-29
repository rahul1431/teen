import paramiko
import sys
import io
import json
import time

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

        # The env_file is already set to /opt/teen-dev/services/admin-service/.env.dev
        # which has the correct DATABASE_URL. The issue is PM2 env block overrides it.
        # We need to set the correct env via pm2 restart with env override.
        
        # Read the correct DATABASE_URL from .env.dev
        out, _ = run(client, "grep DATABASE_URL /opt/teen-dev/services/admin-service/.env.dev")
        print("Current .env.dev DATABASE_URL:", out)
        # Parse: DATABASE_URL=postgresql://...
        db_url = out.split('=', 1)[1].strip() if '=' in out else ''
        redis_url_line, _ = run(client, "grep REDIS_URL /opt/teen-dev/services/admin-service/.env.dev")
        redis_url = redis_url_line.split('=', 1)[1].strip() if '=' in redis_url_line else ''
        
        print(f"DB URL: {db_url}")
        print(f"Redis URL: {redis_url}")
        
        # Use pm2 set to inject correct environment into the process
        # The most reliable way: stop, then start fresh with the env file only (no bad env block override)
        # Since we can't easily modify PM2's in-memory env block, use workaround:
        # Write a wrapper script that sources .env.dev first
        
        # Actually, the simplest fix: pm2 restart with explicit env vars
        cmd = f'DATABASE_URL="{db_url}" REDIS_URL="{redis_url}" pm2 restart teen-admin-svc-dev --update-env'
        print(f"\nRunning: {cmd}")
        out, err = run(client, cmd, timeout=30)
        print("Output:", out)
        if err:
            print("Err:", err[:200])
        
        time.sleep(4)

        # Test login now
        print("\nTesting login on DEV (port 3208)...")
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        print("Login response:", out[:400])
        
        try:
            data = json.loads(out)
            token = data.get('token') or data.get('access_token') or ''
            if token:
                print(f"\n✅ Login successful! Token: {token[:30]}...")
                
                # Test deployment-health endpoint
                print("\nTesting /api/admin/dev/deployment-health...")
                out2, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployment-health \
                  -H 'Authorization: Bearer {token}'""", timeout=15)
                d = json.loads(out2)
                print("Keys:", list(d.keys()))
                
                # Test deployments list
                print("\nTesting /api/admin/dev/deployments...")
                out3, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployments \
                  -H 'Authorization: Bearer {token}'""", timeout=15)
                d2 = json.loads(out3)
                print("Keys:", list(d2.keys()), "count:", len(d2.get('deployments', [])))
            else:
                print("❌ Login failed:", data)
        except Exception as e:
            print("Parse error:", e, "raw:", out[:300])

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
