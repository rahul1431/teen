import paramiko
import sys
import io
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
        print("Connected to VPS.\n")

        # Check PM2 status for admin services
        print("="*60)
        print("PM2 - Admin Services Status")
        print("="*60)
        out, _ = run(client, "pm2 show teen-admin-svc-dev | grep -E 'status|restarts|uptime'")
        print(f"DEV admin-svc:\n{out}")
        out, _ = run(client, "pm2 show teen-admin-svc | grep -E 'status|restarts|uptime'")
        print(f"\nPROD admin-svc:\n{out}")

        # Hit dev health endpoint
        print("\n" + "="*60)
        print("Health Check - DEV admin-service (port 3208)")
        print("="*60)
        out, err = run(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3208/health")
        print(f"HTTP status: {out}")

        # Hit prod health endpoint
        print("\n" + "="*60)
        print("Health Check - PROD admin-service (port 3008)")
        print("="*60)
        out, err = run(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3008/health")
        print(f"HTTP status: {out}")

        # Test the new /api/admin/dev/deployment-health endpoint on dev
        print("\n" + "="*60)
        print("API Test - /api/admin/dev/deployment-health on DEV (3208)")
        print("="*60)
        # We need a JWT token to test authenticated endpoints. Let's get one.
        token_cmd = """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','NO_TOKEN'))" """
        out, err = run(client, token_cmd, timeout=10)
        token = out.strip()
        print(f"Got token: {token[:30]}..." if len(token) > 30 else f"Token: {token}")

        if token and token != 'NO_TOKEN':
            # Test deployment-health endpoint
            health_cmd = f"""curl -s -X GET http://127.0.0.1:3208/api/admin/dev/deployment-health \
              -H 'Authorization: Bearer {token}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(list(d.keys())))" """
            out, err = run(client, health_cmd, timeout=15)
            print(f"Deployment health endpoint keys: {out}")

            # Test deployments list endpoint
            depl_cmd = f"""curl -s -X GET http://127.0.0.1:3208/api/admin/dev/deployments \
              -H 'Authorization: Bearer {token}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('count:', len(d.get('deployments',[])), 'keys:', list(d.keys()))" """
            out, err = run(client, depl_cmd, timeout=15)
            print(f"Deployments endpoint: {out}")
        else:
            print("Could not get token, skipping API tests")

        print("\n✅ Verification complete!")

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
