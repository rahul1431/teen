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
        print("Connected to VPS. Generating verified bcryptjs hash...")
        
        node_cmd = "node -e \"const bcrypt = require('/opt/teen/services/admin-service/node_modules/bcryptjs'); bcrypt.hash('Admin@123456', 10).then(h => console.log('HASH:', h)).catch(err => console.error(err));\""
        
        stdin, stdout, stderr = client.exec_command(node_cmd)
        out = stdout.read().decode('utf-8', errors='replace').strip()
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if out:
            print("STDOUT:", out)
        if err:
            print("STDERR:", err)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
