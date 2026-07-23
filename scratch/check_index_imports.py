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

        # Check if registerDeploymentRoutes is imported and called in compiled index.js
        print("=== grep 'registerDeployment' in dist/index.js ===")
        out, _ = run(client, "grep -n 'registerDeployment\\|deployment-routes\\|deploymentRoutes' /opt/teen-dev/services/admin-service/dist/index.js | head -20")
        print(out if out else "NOT FOUND - deployment routes not imported in index.js!")

        # Check what IS imported at end of index.js
        print("\n=== Last 50 lines of compiled dist/index.js ===")
        out, _ = run(client, "tail -80 /opt/teen-dev/services/admin-service/dist/index.js")
        print(out)

        # Check source index.ts for registerDeploymentRoutes
        print("\n=== grep 'registerDeployment' in src/index.ts on VPS ===")
        out, _ = run(client, "grep -n 'registerDeployment\\|deployment-routes' /opt/teen-dev/services/admin-service/src/index.ts | head -10")
        print(out if out else "NOT FOUND in src/index.ts on VPS!")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
