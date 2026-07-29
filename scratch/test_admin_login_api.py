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
        print("Connected to VPS. Testing dev admin login API endpoint...")
        
        credentials = [
            {"username": "superadmin", "password": "Admin@123456"},
            {"username": "admin", "password": "Admin@123456"}
        ]
        
        for creds in credentials:
            print("="*60)
            print(f"Testing login for: {creds['username']}")
            print("="*60)
            
            # Escape double quotes for json string in curl
            payload = json.dumps(creds).replace('"', '\\"')
            curl_cmd = (
                f"curl -s -i -X POST http://127.0.0.1:3208/api/admin/auth/login "
                f"-H \"Content-Type: application/json\" -d \"{payload}\""
            )
            
            stdin, stdout, stderr = client.exec_command(curl_cmd)
            out = stdout.read().decode('utf-8', errors='replace').strip()
            print(out)

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
