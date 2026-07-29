import paramiko
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def analyze():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Successfully connected to VPS. Running audit commands...\n")

        commands = {
            "PM2 Status": "pm2 status",
            "Nginx Configs Enabled": "ls -l /etc/nginx/sites-enabled/",
            "Hestia Web Domains": "v-list-web-domains admin || ls -la /home/admin/web/",
            "Dev Admin Public HTML": "ls -la /home/admin/web/dev.myonlinejoker.com/public_html/admin/ || echo 'dev.myonlinejoker.com admin dir not found'",
            "Prod Admin Public HTML": "ls -la /home/admin/web/game.myonlinejoker.com/public_html/admin/ || echo 'game.myonlinejoker.com admin dir not found'",
            "Dev Nginx Configs": "ls -la /home/admin/conf/web/dev.myonlinejoker.com/ || echo 'dev.myonlinejoker.com conf dir not found'",
            "Prod Nginx Configs": "ls -la /home/admin/conf/web/game.myonlinejoker.com/ || echo 'game.myonlinejoker.com conf dir not found'",
            "Check Postgres Databases": "su - postgres -c \"psql -c '\\l'\" || psql -U postgres -c '\\l'",
            "Active connections by database": "su - postgres -c \"psql -c \\\"SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;\\\"\"",
            "PM2 Env DATABASE_URL & PORT sample": "pm2 jlist | jq '.[] | {name: .name, pid: .pid, status: .pm2_env.status, port: .pm2_env.PORT, db: .pm2_env.DATABASE_URL}' || echo 'jq not found'",
        }

        for name, cmd in commands.items():
            print("="*60)
            print(f"AUDIT STEP: {name}")
            print(f"COMMAND: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out)
            if err:
                print("ERROR OUTPUT:")
                print(err)
            print("\n")

        # Let's inspect nginx config for dev and prod specifically
        nginx_inspect_cmds = [
            "cat /etc/nginx/sites-enabled/dev.myonlinejoker.com || cat /etc/nginx/sites-available/dev.myonlinejoker.com || echo 'dev.myonlinejoker.com sites config not found'",
            "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.conf || echo 'Hestia dev nginx.conf not found'",
            "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf || echo 'Hestia dev nginx.ssl.conf not found'",
            "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.conf_api || echo 'Hestia dev nginx.conf_api not found'",
            "cat /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf_api || echo 'Hestia dev nginx.ssl.conf_api not found'",
        ]
        
        for cmd in nginx_inspect_cmds:
            print("="*60)
            print(f"INSPECT NGINX: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out[:1000] + ("\n...[TRUNCATED]" if len(out) > 1000 else ""))
            if err:
                print("ERROR:")
                print(err)
            print("\n")

    except Exception as e:
        print(f"Audit failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    analyze()
