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

        print("=== /etc/nginx/conf.d/domains/dev.myonlinejoker.com.conf ===")
        out, _ = run(client, "cat /etc/nginx/conf.d/domains/dev.myonlinejoker.com.conf")
        print(out)

        print("\n=== /etc/nginx/conf.d/domains/dev.myonlinejoker.com.ssl.conf ===")
        out, _ = run(client, "cat /etc/nginx/conf.d/domains/dev.myonlinejoker.com.ssl.conf")
        print(out[:4000])

        # Also test via nginx directly (simulating browser call)
        print("\n=== Test via nginx (external request on port 443) ===")
        out, _ = run(client, "curl -s -o /dev/null -w '%{http_code}' -H 'Host: dev.myonlinejoker.com' https://dev.myonlinejoker.com/api/admin/dev/deployment-health -k")
        print("deployment-health via nginx:", out)
        out, _ = run(client, "curl -s -o /dev/null -w '%{http_code}' -H 'Host: dev.myonlinejoker.com' https://dev.myonlinejoker.com/api/admin/changelogs/git -k")
        print("changelogs/git via nginx:", out)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
