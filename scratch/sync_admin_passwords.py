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
        print("Connected to VPS. Synchronizing production password hashes to dev...")
        
        # We explicitly escape the '$' sign so bash doesn't treat them as variables
        cmds = [
            # Sync 'admin' password hash
            "docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"UPDATE admin_users SET password_hash = '\\$2a\\$12\\$EAe4nEZDp/K52nRtmpUaX.ke0YE0eIAog6ZnoUF.KsK7B2b9Eczqi' WHERE username = 'admin';\"",
            # Sync 'superadmin' password hash
            "docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"UPDATE admin_users SET password_hash = '\\$2a\\$12\\$w5kjY73mYfEGlllikmign.oIutNBILQkJXI4/I7VLkKVyGC1D0IHO' WHERE username = 'superadmin';\""
        ]
        
        for cmd in cmds:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace').strip())
            
        # Verify
        stdin, stdout, stderr = client.exec_command("docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"SELECT username, password_hash FROM admin_users;\"")
        print("\nUpdated dev database hashes:")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
