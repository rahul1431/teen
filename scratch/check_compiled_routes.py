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

        # Search the compiled dist for route paths
        print("=== Routes found in compiled dist/index.js on teen-dev ===")
        out, _ = run(client, "grep -o \"'/api/[^']*'\" /opt/teen-dev/services/admin-service/dist/index.js | sort -u | head -60")
        print(out)
        
        print("\n=== Check if deployment-routes is in dist/index.js ===")
        out, _ = run(client, "grep -c 'deployment' /opt/teen-dev/services/admin-service/dist/index.js")
        print("'deployment' occurrences in dist/index.js:", out)

        print("\n=== Check dist directory listing ===")
        out, _ = run(client, "ls -la /opt/teen-dev/services/admin-service/dist/")
        print(out)
        
        print("\n=== Is deployment-routes compiled as separate file? ===")
        out, _ = run(client, "ls /opt/teen-dev/services/admin-service/dist/ | grep deploy")
        print(out if out else "No separate deployment file found (bundled into index.js)")
        
        print("\n=== Grep deployment routes in ALL dist files ===")
        out, _ = run(client, "grep -r '/api/admin/dev' /opt/teen-dev/services/admin-service/dist/ 2>/dev/null | head -20")
        print(out if out else "NOT FOUND in dist - route prefix may be different in compiled output")
        
        print("\n=== Grep what routes exist under /api/dev in dist ===")
        out, _ = run(client, "grep -o \"'/api/dev[^']*'\" /opt/teen-dev/services/admin-service/dist/index.js 2>/dev/null | sort -u")
        print(out if out else "No /api/dev routes found")

        print("\n=== tsconfig.json check - outDir ===")
        out, _ = run(client, "cat /opt/teen-dev/services/admin-service/tsconfig.json")
        print(out[:500])

    except Exception as e:
        print(f"Failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        client.close()

if __name__ == "__main__":
    main()
