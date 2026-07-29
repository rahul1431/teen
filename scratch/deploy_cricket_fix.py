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
    client.connect(host, username=user, password=pw)
    print("Connected to VPS")

    # 1. Pull latest code
    print("\n1. Git pull...")
    stdin, stdout, stderr = client.exec_command('cd /opt/teen && git pull origin feature/admin-responsive 2>&1')
    print(stdout.read().decode('utf-8', errors='replace').strip())

    # 2. Apply migration 040
    print("\n2. Applying migration 040 (fix cricket player credits)...")
    stdin, stdout, stderr = client.exec_command(
        'docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen/infra/db/migrations/040_fix_cricket_player_credits.sql 2>&1'
    )
    print(stdout.read().decode('utf-8', errors='replace').strip()[:500])

    # 3. Rebuild core-api-service
    print("\n3. Rebuilding core-api-service...")
    stdin, stdout, stderr = client.exec_command("cd /opt/teen/services/core-api-service && npm run build 2>&1 | tail -5")
    print(stdout.read().decode('utf-8', errors='replace').strip())

    # 4. Restart core-api
    stdin, stdout, stderr = client.exec_command("pm2 restart teen-core-api 2>&1 | tail -3")
    print("PM2:", stdout.read().decode('utf-8').strip())

    print("\n✅ Cricket fix deployed!")
    client.close()

if __name__ == "__main__":
    main()
