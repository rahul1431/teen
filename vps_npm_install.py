import paramiko

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_commands():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print(f"Connected to {host}")

        services = [
            "auth-service", "user-service", "wallet-service",
            "game-gateway", "game-engines/aviator", "game-engines/ludo",
            "leaderboard-service", "notification-service", "admin-service",
            "betting-service"
        ]

        for svc in services:
            cmd = f"cd /opt/teen/services/{svc} && npm install --no-audit --no-fund"
            print(f"Installing deps for {svc}...")
            stdin, stdout, stderr = client.exec_command(cmd)
            stdout.channel.recv_exit_status()
            print(f"Done {svc}")

    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_commands()
