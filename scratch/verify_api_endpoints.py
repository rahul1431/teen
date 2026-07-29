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

        # Get raw login response to see structure
        out, _ = run(client, """curl -s -X POST http://127.0.0.1:3208/api/admin/auth/login \
          -H 'Content-Type: application/json' \
          -d '{"username":"superadmin","password":"Admin@123456"}'""", timeout=10)
        print("Login response:", out[:500])
        
        # Try to parse token
        try:
            data = json.loads(out)
            token = data.get('token') or data.get('access_token') or data.get('accessToken') or ''
            print(f"\nToken key found: {'token' if 'token' in data else 'access_token' if 'access_token' in data else 'accessToken' if 'accessToken' in data else 'NONE'}")
        except Exception as e:
            print(f"Parse error: {e}")
            token = ''

        if token:
            print(f"\nToken (first 40 chars): {token[:40]}...")
            
            # Test deployment-health endpoint
            print("\nTesting /api/admin/dev/deployment-health ...")
            out, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployment-health \
              -H 'Authorization: Bearer {token}'""", timeout=15)
            try:
                d = json.loads(out)
                print("Response keys:", list(d.keys()))
                if 'git' in d:
                    print("Git data:", d['git'])
            except:
                print("Raw:", out[:300])

            # Test deployments list
            print("\nTesting /api/admin/dev/deployments ...")
            out, _ = run(client, f"""curl -s http://127.0.0.1:3208/api/admin/dev/deployments \
              -H 'Authorization: Bearer {token}'""", timeout=15)
            try:
                d = json.loads(out)
                print("Response keys:", list(d.keys()))
                print("Deployment count:", len(d.get('deployments', [])))
            except:
                print("Raw:", out[:300])
        else:
            print("\nNo token obtained. Check password or username.")

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
