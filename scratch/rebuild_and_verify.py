import paramiko
import sys
import io
import time
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected. Uploading latest source files...")

        sftp = client.open_sftp()

        # Upload deployment-routes.ts and deployment.service.ts to BOTH envs
        for env in ['teen-dev', 'teen-prod']:
            base = f'/opt/{env}/services/admin-service'
            sftp.put("services/admin-service/src/deployment-routes.ts",
                     f"{base}/src/deployment-routes.ts")
            sftp.put("services/admin-service/src/services/deployment.service.ts",
                     f"{base}/src/services/deployment.service.ts")
            print(f"Uploaded to /opt/{env}")

        sftp.close()

        # Rebuild both environments
        for env, pm2_name in [('teen-dev', 'teen-admin-svc-dev'), ('teen-prod', 'teen-admin-svc')]:
            print(f"\nBuilding {env} admin-service...")
            out, err = run(client, f"cd /opt/{env}/services/admin-service && npm run build 2>&1", timeout=90)
            if 'error' in out.lower() and 'error TS' in out:
                print(f"❌ Build FAILED for {env}:\n{out[-1000:]}")
            else:
                print(f"✅ Build OK for {env}")
            
            # Restart with --update-env to pick up correct DATABASE_URL
            print(f"Restarting {pm2_name} with --update-env...")
            out2, err2 = run(client, f"pm2 restart {pm2_name} --update-env 2>&1", timeout=30)
            print(out2[-500:])

        # Wait for services to start
        print("\nWaiting 5s for services to start...")
        time.sleep(5)

        # Test login
        print("\n=== Testing login on DEV (port 3208) ===")
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        data = json.loads(out)
        token = data.get('token', '')
        if not token:
            print("❌ Login failed:", out[:300])
            return
        print("✅ Login OK")

        # Test deployment endpoints
        for endpoint in ['/api/admin/dev/deployment-health', '/api/admin/dev/deployments', '/api/admin/dev/safety-checks']:
            print(f"\nGET {endpoint}")
            out2, _ = run(client, f"""curl -s http://127.0.0.1:3208{endpoint} \
              -H 'Authorization: Bearer {token}'""", timeout=10)
            try:
                d = json.loads(out2)
                if 'error' in d or 'statusCode' in d:
                    print(f"  ❌ {d}")
                else:
                    print(f"  ✅ Keys: {list(d.keys())}")
            except:
                print(f"  Raw: {out2[:200]}")

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
