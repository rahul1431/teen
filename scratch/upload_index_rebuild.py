import paramiko
import sys
import io
import json
import time

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
        sftp = client.open_sftp()

        print("Uploading src/index.ts to both environments...")
        sftp.put("services/admin-service/src/index.ts",
                 "/opt/teen-dev/services/admin-service/src/index.ts")
        print("Uploaded to teen-dev")
        sftp.put("services/admin-service/src/index.ts",
                 "/opt/teen-prod/services/admin-service/src/index.ts")
        print("Uploaded to teen-prod")
        sftp.close()

        # Rebuild both
        for env, pm2_name in [('teen-dev', 'teen-admin-svc-dev'), ('teen-prod', 'teen-admin-svc')]:
            print(f"\nBuilding {env}...")
            out, err = run(client, f"cd /opt/{env}/services/admin-service && npm run build 2>&1", timeout=120)
            if 'error TS' in out:
                print(f"❌ Build FAILED:\n{out[-1500:]}")
            else:
                print(f"✅ Build OK for {env}")

            # Verify deployment is now in index.js
            out2, _ = run(client, f"grep -c 'registerDeploymentRoutes\\|deployment-routes' /opt/{env}/services/admin-service/dist/index.js")
            print(f"  'deployment' references in dist/index.js: {out2}")

            # Restart with update-env
            out3, err3 = run(client, f"pm2 restart {pm2_name} --update-env 2>&1", timeout=30)
            status = "✅ Restarted" if "✓" in out3 else "⚠️ " + out3[-200:]
            print(f"  {pm2_name}: {status}")

        # Wait and test
        time.sleep(5)
        print("\n=== Login test ===")
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        data = json.loads(out)
        token = data.get('token', '')
        print("Login:", "✅ OK" if token else "❌ FAILED: " + out[:200])

        if token:
            for ep in ['/api/admin/dev/deployment-health', '/api/admin/dev/deployments']:
                out2, _ = run(client, f"""curl -s http://127.0.0.1:3208{ep} \
                  -H 'Authorization: Bearer {token}'""", timeout=10)
                try:
                    d = json.loads(out2)
                    if 'error' in d:
                        print(f"{ep}: ❌ {d}")
                    else:
                        print(f"{ep}: ✅ Keys={list(d.keys())}")
                except:
                    print(f"{ep}: Raw={out2[:200]}")

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
