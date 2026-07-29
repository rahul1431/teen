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
        print("Connected to VPS. Creating directories...")
        
        # Create directories
        client.exec_command("mkdir -p /opt/teen-dev/services/admin-service/src/services")
        client.exec_command("mkdir -p /opt/teen-prod/services/admin-service/src/services")
        
        # SFTP Upload
        sftp = client.open_sftp()
        
        # Upload to teen-dev
        print("Uploading to /opt/teen-dev...")
        sftp.put("services/admin-service/src/deployment-routes.ts", "/opt/teen-dev/services/admin-service/src/deployment-routes.ts")
        sftp.put("services/admin-service/src/services/deployment.service.ts", "/opt/teen-dev/services/admin-service/src/services/deployment.service.ts")
        
        # Upload to teen-prod
        print("Uploading to /opt/teen-prod...")
        sftp.put("services/admin-service/src/deployment-routes.ts", "/opt/teen-prod/services/admin-service/src/deployment-routes.ts")
        sftp.put("services/admin-service/src/services/deployment.service.ts", "/opt/teen-prod/services/admin-service/src/services/deployment.service.ts")
        
        sftp.close()
        print("Uploads completed.")
        
        # Build dev
        print("Building admin-service on dev...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-dev/services/admin-service && npm run build")
        print("Dev build output:")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # Build prod
        print("Building admin-service on prod...")
        stdin, stdout, stderr = client.exec_command("cd /opt/teen-prod/services/admin-service && npm run build")
        print("Prod build output:")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        print(stderr.read().decode('utf-8', errors='replace').strip())
        
        # Restart PM2
        print("Restarting admin-service PM2 instances...")
        stdin, stdout, stderr = client.exec_command("pm2 restart teen-admin-svc-dev teen-admin-svc")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
