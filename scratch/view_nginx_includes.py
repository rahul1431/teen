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
        print("Connected to VPS. Reading custom Nginx includes...")
        
        files = [
            "/home/admin/conf/web/dev.myonlinejoker.com/nginx.ssl.conf_api",
            "/home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_admin",
            "/home/admin/conf/web/game.myonlinejoker.com/nginx.ssl.conf_api"
        ]
        
        for file in files:
            print("="*80)
            print(f"File: {file}")
            print("="*80)
            stdin, stdout, stderr = client.exec_command(f"cat {file}")
            print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
