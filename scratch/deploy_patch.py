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
    
    # 1. Apply cricket players migration
    print("\n1. Applying cricket players migration...")
    stdin, stdout, stderr = client.exec_command(
        'docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen/infra/db/migrations/039_seed_famous_cricket_players.sql 2>&1'
    )
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    print("OUT:", out[:500] if out else "(none)")
    print("ERR:", err[:300] if err else "(none)")

    # 2. Pull latest code
    print("\n2. Git pull latest...")
    stdin, stdout, stderr = client.exec_command('cd /opt/teen && git pull origin feature/admin-responsive 2>&1')
    print(stdout.read().decode('utf-8', errors='replace').strip())

    # 3. Rebuild and redeploy only admin panel (fast)
    print("\n3. Rebuilding admin panel...")
    stdin, stdout, stderr = client.exec_command(
        "cd /opt/teen/admin-panel && npm install --silent --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/ 2>&1"
    )
    while True:
        line = stdout.readline()
        if not line:
            break
        print(line, end='')
    
    print("\n4. Deploying admin panel to webroot...")
    stdin, stdout, stderr = client.exec_command(
        "cp -rf /opt/teen/admin-panel/dist/. /home/admin/web/game.myonlinejoker.com/public_html/admin/ && echo 'Admin panel deployed OK'"
    )
    print(stdout.read().decode('utf-8').strip())

    # 5. Rebuild and restart core-api-service only (for betting plugin changes)
    print("\n5. Rebuilding core-api-service...")
    stdin, stdout, stderr = client.exec_command(
        "cd /opt/teen/services/core-api-service && npm run build 2>&1 | tail -5"
    )
    print(stdout.read().decode('utf-8').strip())
    
    stdin, stdout, stderr = client.exec_command("pm2 restart teen-core-api 2>&1 | tail -3")
    print("PM2 restart:", stdout.read().decode('utf-8').strip())

    # 6. Verify all services still online
    print("\n6. PM2 Status:")
    stdin, stdout, stderr = client.exec_command("pm2 ls 2>&1 | tail -20")
    print(stdout.read().decode('utf-8').strip())

    client.close()
    print("\n✅ Done!")

if __name__ == "__main__":
    main()
