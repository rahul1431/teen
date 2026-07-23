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
        print("Connected to VPS. Updating Nginx configuration files...")
        
        # We will use sed to replace /opt/teen/ with /opt/teen-dev/ for dev and /opt/teen-prod/ for prod
        cmds = [
            # dev config updates
            "sed -i 's|/opt/teen/|/opt/teen-dev/|g' /home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf_api",
            "sed -i 's|/opt/teen/|/opt/teen-dev/|g' /home/admin/conf/web/dev.myonlinejoker.com/nginx.conf_api",
            
            # prod config updates
            "sed -i 's|/opt/teen/|/opt/teen-prod/|g' /home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api",
            "sed -i 's|/opt/teen/|/opt/teen-prod/|g' /home/admin/conf/web/game.myonlinejoker.com/nginx.conf_api",
            
            # test nginx
            "nginx -t",
            
            # reload nginx
            "systemctl reload nginx"
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace').strip()
            err = stderr.read().decode('utf-8', errors='replace').strip()
            if out:
                print("STDOUT:", out)
            if err:
                print("STDERR:", err)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
