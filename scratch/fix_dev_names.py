import paramiko
import sys
import io
import re

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def main():
    # 1. Modify ecosystem.config.dev.js locally to append -dev to all app names
    print("Modifying ecosystem.config.dev.js to append -dev to app names...")
    with open("ecosystem.config.dev.js", "r", encoding="utf-8") as f:
        content = f.read()
        
    # Replace name: 'xxx' with name: 'xxx-dev'
    modified = re.sub(r"name:\s*'([^']+)'", r"name: '\1-dev'", content)
    
    with open("ecosystem.config.dev.js", "w", encoding="utf-8") as f:
        f.write(modified)
    print("ecosystem.config.dev.js updated locally.")
    
    # 2. Upload and restart dev services
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Uploading configurations...")
        
        sftp = client.open_sftp()
        sftp.put("ecosystem.config.dev.js", "/opt/teen-dev/ecosystem.config.dev.js")
        sftp.put("ecosystem.config.dev.js", "/opt/teen-dev/ecosystem.dev.config.js")
        sftp.close()
        
        # Stop and delete any old processes
        client.exec_command("pm2 delete all || true")
        
        # Start dev
        print("Starting dev services on VPS...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-dev && pm2 start ecosystem.dev.config.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # Start prod
        print("Starting prod services on VPS...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-prod && pm2 start ecosystem.config.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        client.exec_command("pm2 save")
        
        import time
        print("Waiting 5 seconds for services to stabilize...")
        time.sleep(5)
        
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print("\nPM2 Status:")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
