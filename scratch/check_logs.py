import paramiko
import sys

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS...")
        sys.stdout.reconfigure(encoding='utf-8')
        
        # Git commands to check how behind/ahead local is
        commands = [
            "cd /opt/teen-prod && git fetch origin",
            "cd /opt/teen-prod && git status",
            "cd /opt/teen-prod && git branch -vv",
            "cd /opt/teen-prod && git log -n 5 --oneline",
            "cd /opt/teen-prod && git log HEAD..origin/$(git rev-parse --abbrev-ref HEAD) --oneline"
        ]
        for cmd in commands:
            print(f"\n---> Running: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8'))
            print(stderr.read().decode('utf-8'))
                
    except Exception as e:
        print("Error:", e)
    finally:
        client.close()

if __name__ == "__main__":
    main()
