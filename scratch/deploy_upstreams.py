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
        print("Connected to VPS. Deploying isolated gateway upstreams...")
        
        dev_upstream_content = """upstream dev_game_backend {
    server 127.0.0.1:3204;
    server 127.0.0.1:3221;
    server 127.0.0.1:3222;
    least_conn;
    keepalive 32;
}
"""

        prod_upstream_content = """upstream prod_game_backend {
    server 127.0.0.1:3004;
    server 127.0.0.1:3021;
    server 127.0.0.1:3022;
    least_conn;
    keepalive 64;
}
"""

        sftp = client.open_sftp()
        
        print("Writing dev-game-upstream.conf...")
        f_dev = sftp.open("/etc/nginx/conf.d/dev-game-upstream.conf", "w")
        f_dev.write(dev_upstream_content)
        f_dev.close()
        
        print("Writing prod-game-upstream.conf...")
        f_prod = sftp.open("/etc/nginx/conf.d/prod-game-upstream.conf", "w")
        f_prod.write(prod_upstream_content)
        f_prod.close()
        
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
                
        print("\nStep 6 completed successfully.")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
