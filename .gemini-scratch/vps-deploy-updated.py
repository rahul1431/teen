import paramiko
import sys

def run_deploy():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect('64.204.130.181', username='root', password='4sXWo02f4WkNm8fM', timeout=15)
        print("Connected to VPS.")
        
        commands = [
            "echo '=== DISCARDING LOCAL CHANGES ==='",
            "cd /opt/teen && git restore .",
            "echo '=== PULLING LATEST CODE ==='",
            "cd /opt/teen && git pull origin claude/confident-archimedes-e2dd1k",
            "echo '=== BUILDING SERVICES ==='",
            "for svc in auth-service user-service wallet-service leaderboard-service notification-service admin-service; do echo \"  -> Building $svc...\" && cd /opt/teen/services/$svc && npm install --production=false && npm run build || exit 1; done",
            "echo '=== RESTARTING SERVICES IN PM2 ==='",
            "pm2 restart teen-auth teen-user teen-wallet teen-leaderboard teen-notify teen-admin-svc",
            "echo '=== PM2 STATUS ==='",
            "pm2 list"
        ]
        
        full_cmd = " && ".join(commands)
        
        stdin, stdout, stderr = client.exec_command(full_cmd, timeout=300)
        
        # Read output stream-by-stream or line-by-line
        for line in stdout:
            print(line, end='')
            
        err = stderr.read().decode('utf-8', errors='replace')
        if err:
            print("\nError output:")
            print(err)
            
    except Exception as e:
        print(f"SSH Execution failed: {e}")
    finally:
        client.close()

if __name__ == '__main__':
    run_deploy()
