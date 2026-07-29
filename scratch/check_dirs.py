import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Checking directories and CWDs...")
        
        cmds = [
            "ls -la /opt/",
            "pm2 show teen-admin-svc | grep 'exec cwd'",
            "pm2 show teen-admin-svc-dev | grep 'exec cwd'",
            "pm2 show teen-core-api | grep 'exec cwd'",
            "pm2 show teen-core-api-dev | grep 'exec cwd'"
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            print(out.strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
