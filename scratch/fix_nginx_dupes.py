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
        print("Connected to VPS. Removing duplicate admin locations in dev nginx.conf...")
        
        sftp = client.open_sftp()
        filepath = "/home/admin/conf/web/dev.myonlinejoker.com/nginx.conf"
        content = sftp.open(filepath).read().decode('utf-8')
        
        # Define the block to remove
        block_to_remove = """\tlocation /api/admin {
\t\tproxy_pass http://127.0.0.1:3001;
\t\tproxy_set_header Host $host;
\t\tproxy_set_header X-Real-IP $remote_addr;
\t\tproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
\t\tproxy_set_header X-Forwarded-Proto $scheme;
\t\tproxy_set_header Connection "upgrade";
\t\tproxy_set_header Upgrade $http_upgrade;
\t}
\t# Serve admin panel frontend
\tlocation /admin {
\t\talias /opt/teen/admin-panel/dist;
\t\ttry_files $uri $uri/ /index.html;
\t\texpires 1d;
\t}"""
        
        if block_to_remove in content:
            content = content.replace(block_to_remove, "")
            f = sftp.open(filepath, "w")
            f.write(content)
            f.close()
            print("Successfully removed duplicate admin blocks.")
        else:
            # Try a regex in case whitespace is slightly different
            import re
            pattern = r"\tlocation /api/admin \{[\s\S]*?expires 1d;\s*\}"
            if re.search(pattern, content):
                content = re.sub(pattern, "", content)
                f = sftp.open(filepath, "w")
                f.write(content)
                f.close()
                print("Successfully removed duplicate admin blocks via regex.")
            else:
                print("Target block not found in nginx.conf")
                
        sftp.close()
        
        # Test and reload Nginx
        cmds = [
            "nginx -t",
            "systemctl reload nginx"
        ]
        for cmd in cmds:
            print(f"\nExecuting: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR / STDERR:")
                print(err.strip())
                
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
