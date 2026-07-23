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
        print("Connected to VPS. Resetting admin and superadmin passwords to 'Admin@123456'...")
        
        # We will use the verified hash: $2a$10$eGK1ATwIxt.sYylx3dmra.ZONzOYak7mVQ9mWbrA0Y5Crrw4Y8kIS
        cmds = [
            # Reset production (teen_db)
            "docker exec -i teen_postgres psql -U teen -d teen_db -c \"UPDATE admin_users SET password_hash = '\\$2a\\$10\\$eGK1ATwIxt.sYylx3dmra.ZONzOYak7mVQ9mWbrA0Y5Crrw4Y8kIS' WHERE username IN ('admin', 'superadmin');\"",
            # Reset dev (teen_db_dev)
            "docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"UPDATE admin_users SET password_hash = '\\$2a\\$10\\$eGK1ATwIxt.sYylx3dmra.ZONzOYak7mVQ9mWbrA0Y5Crrw4Y8kIS' WHERE username IN ('admin', 'superadmin');\""
        ]
        
        for cmd in cmds:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace').strip())
            
        # Verify
        print("\nVerifying production (teen_db) admin_users:")
        stdin, stdout, stderr = client.exec_command("docker exec -i teen_postgres psql -U teen -d teen_db -c \"SELECT username, is_active FROM admin_users;\"")
        print(stdout.read().decode('utf-8', errors='replace').strip())
        
        print("\nVerifying dev (teen_db_dev) admin_users:")
        stdin, stdout, stderr = client.exec_command("docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"SELECT username, is_active FROM admin_users;\"")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
