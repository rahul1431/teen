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
        print("Connected to VPS. Reading ecosystem.config.js...")
        
        stdin, stdout, stderr = client.exec_command("cat /opt/teen/ecosystem.config.js | grep -A 15 -B 2 'teen-admin-svc'")
        print(stdout.read().decode('utf-8', errors='replace'))
    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
