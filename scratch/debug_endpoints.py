import paramiko
import sys
import io
import json

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
        token = json.loads(out).get('token', '')
        print(f"Token: {'OK' if token else 'FAILED'}")

        if not token:
            print("Login failed:", out[:300])
            return

        # Test all relevant routes
        endpoints = [
            'GET /api/admin/dev/deployment-health',
            'GET /api/admin/dev/deployments',
            'GET /api/admin/changelogs/git',
            'GET /api/admin/changelogs',
        ]

        for ep in endpoints:
            method, path = ep.split(' ', 1)
            out2, _ = run(client, f"""curl -s -X {method} http://127.0.0.1:3208{path} \
              -H 'Authorization: Bearer {token}'""", timeout=10)
            try:
                d = json.loads(out2)
                if isinstance(d, list):
                    print(f"{path}: ✅ array len={len(d)}")
                elif 'error' in d or 'statusCode' in d:
                    print(f"{path}: ❌ {d.get('message', d.get('error', ''))}")
                else:
                    print(f"{path}: ✅ keys={list(d.keys())[:5]}")
            except:
                print(f"{path}: Raw={out2[:100]}")

        # Check if changelogs/git exists in compiled binary
        out3, _ = run(client, "grep -c 'changelogs/git' /opt/teen-dev/services/admin-service/dist/index.js")
        print(f"\n'changelogs/git' occurrences in dist/index.js: {out3}")

        # Check nginx for dev admin routing
        print("\n=== Nginx config for dev admin /api/admin/ proxy ===")
        out4, _ = run(client, "grep -n 'api/admin\\|3208\\|proxy_pass' /etc/nginx/conf.d/dev.myonlinejoker.com.conf 2>/dev/null | head -20")
        print(out4 if out4 else "Not found in conf.d, checking web.d...")
        out5, _ = run(client, "find /etc/nginx -name 'dev.myonlinejoker*' 2>/dev/null")
        print("Config files:", out5)

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
