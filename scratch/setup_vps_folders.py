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
        print("Connected to VPS. Setting up separate directories...")
        
        # Stop PM2 processes to release any open file locks
        print("Stopping existing PM2 processes...")
        stdin, stdout, stderr = client.exec_command("pm2 delete all || true")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        # Check if teen-dev already exists
        stdin, stdout, stderr = client.exec_command("ls -la /opt/")
        opt_list = stdout.read().decode('utf-8', errors='replace')
        
        if "teen-dev" not in opt_list:
            print("Renaming /opt/teen to /opt/teen-dev...")
            stdin, stdout, stderr = client.exec_command("mv /opt/teen /opt/teen-dev")
            print(stderr.read().decode('utf-8', errors='replace').strip())
        else:
            print("/opt/teen-dev already exists.")
            
        if "teen-prod" not in opt_list:
            print("Cloning /opt/teen-dev to /opt/teen-prod...")
            stdin, stdout, stderr = client.exec_command("cp -rp /opt/teen-dev /opt/teen-prod")
            print(stderr.read().decode('utf-8', errors='replace').strip())
        else:
            print("/opt/teen-prod already exists.")
            
        # Verify the directory setup
        stdin, stdout, stderr = client.exec_command("ls -la /opt/")
        print("\nUpdated /opt directories:")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
