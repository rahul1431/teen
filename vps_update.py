import paramiko
import sys

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_commands():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print(f"Connected to {host}")

        commands = [
            "pm2 list",
            "cd /opt/teen/services/game-engines/teen-patti && ls -la",
            # Apply the A-2-3 and Pot fixes directly on VPS
            "sed -i 's/isSeq := (ranks\\[0\\]-ranks\\[1\\] == 1 && ranks\\[1\\]-ranks\\[2\\] == 1) || (ranks\\[0\\] == 14 \\&\\& ranks\\[1\\] == 3 \\&\\& ranks\\[2\\] == 2)/isSeq := (ranks[0]-ranks[1] == 1 \\&\\& ranks[1]-ranks[2] == 1); isAce23 := (ranks[0] == 14 \\&\\& ranks[1] == 3 \\&\\& ranks[2] == 2)/' /opt/teen/services/game-engines/teen-patti/main.go",
            # Rebuild and restart
            "cd /opt/teen/services/game-engines/teen-patti && /usr/local/go/bin/go build -o teen-patti-engine .",
            "pm2 restart teen-tp-engine || pm2 restart 7 || echo 'Could not find pm2 process, please check pm2 list'",
            "pm2 status"
        ]

        for cmd in commands:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode()
            err = stderr.read().decode()
            if out: print(out)
            if err: print(f"ERROR: {err}")

    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_commands()
