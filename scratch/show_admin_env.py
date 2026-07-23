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

        # Check current .env.dev for dev admin-service
        print("Current .env.dev for admin-service (DEV):")
        out, _ = run(client, "cat /opt/teen-dev/services/admin-service/.env.dev")
        print(out)

        # Check current .env for prod admin-service (for reference)
        print("\nCurrent .env for admin-service (PROD):")
        out, _ = run(client, "cat /opt/teen-prod/services/admin-service/.env")
        print(out)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
