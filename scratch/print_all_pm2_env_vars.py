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
        
        for name, pid in [("prod", 14), ("dev", 32)]:
            print("="*60)
            print(f"PM2 Env variables for {name} (PID: {pid})")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(f"pm2 env {pid}")
            out = stdout.read().decode('utf-8', errors='replace')
            for line in out.split("\n"):
                if any(k in line for k in ["DB_", "REDIS_", "NODE_ENV", "PORT", "env_file"]):
                    print(line.strip())
                    
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
