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
        print("Connected to VPS. Uploading PM2 configurations...")
        
        sftp = client.open_sftp()
        
        # Upload local ecosystem.config.js to /opt/teen-prod/ecosystem.config.js
        sftp.put("ecosystem.config.js", "/opt/teen-prod/ecosystem.config.js")
        print("Uploaded ecosystem.config.js to /opt/teen-prod/")
        
        # Upload local ecosystem.config.dev.js to /opt/teen-dev/ecosystem.config.dev.js
        sftp.put("ecosystem.config.dev.js", "/opt/teen-dev/ecosystem.config.dev.js")
        # Also upload it to ecosystem.dev.config.js to match the naming used previously
        sftp.put("ecosystem.config.dev.js", "/opt/teen-dev/ecosystem.dev.config.js")
        print("Uploaded ecosystem.config.dev.js to /opt/teen-dev/")
        
        sftp.close()
        
        # Start dev services
        print("Starting dev services under PM2...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-dev && pm2 start ecosystem.dev.config.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # Start prod services
        print("Starting prod services under PM2...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-prod && pm2 start ecosystem.config.js")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # Save state
        client.exec_command("pm2 save")
        
        # Wait a moment for startup and print PM2 status
        import time
        print("Waiting 5 seconds for services to initialize...")
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
