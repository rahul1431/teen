import paramiko
import sys
import io
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Validating environment configuration isolation...")
        
        # We can dump PM2 process environment variables using pm2 show <name_or_id>
        apps = ["teen-core-api", "teen-core-api-dev"]
        for app in apps:
            print("="*60)
            print(f"PM2 Environment for: {app}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(f"pm2 show {app}")
            out = stdout.read().decode('utf-8', errors='replace')
            
            # Print relevant environment variables from the pm2 show output
            lines = out.split("\n")
            for line in lines:
                if any(var in line for var in [
                    "status", "mode", "port", "DB_", "REDIS_", "NODE_ENV", "PORT", "JWT_SECRET"
                ]):
                    # Clean up ANSI escape sequences if any
                    clean_line = line.strip()
                    print(clean_line)
                    
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
