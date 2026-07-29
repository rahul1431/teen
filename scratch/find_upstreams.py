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
        
        cmds = [
            "grep -rn 'upstream dev_game_backend' /etc/nginx/ || echo 'Not in /etc/nginx/'",
            "grep -rn 'upstream dev_game_backend' /home/admin/conf/web/ || echo 'Not in /home/admin/conf/web/'",
            "cat /etc/nginx/conf.d/dev-game-upstream.conf || echo 'No dev-game-upstream.conf'",
            "cat /etc/nginx/conf.d/prod-game-upstream.conf || echo 'No prod-game-upstream.conf'",
            "ls -la /etc/nginx/conf.d/",
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out)
            if err:
                print("ERROR:")
                print(err)
            print("\n")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
