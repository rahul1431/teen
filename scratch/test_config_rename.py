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
        
        cmds = [
            "cp /opt/teen/ecosystem.config.dev.js /opt/teen/ecosystem.dev.config.js",
            "pm2 delete ecosystem.config.dev || true",
            "pm2 delete ecosystem.dev.config || true",
            "cd /opt/teen && pm2 start ecosystem.dev.config.js",
            "pm2 status"
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR:")
                print(err.strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
