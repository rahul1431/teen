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
        print("Connected to VPS. Creating 'admin' user in teen_db_dev...")
        
        # Hash for Admin@123456 is: $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMlJbekRSm9p8zY.9TJnl3WKSK
        sql_cmd = (
            "docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \""
            "INSERT INTO admin_users (username, email, password_hash, role) "
            "VALUES ('admin', 'admin@myonlinejoker.com', "
            "'$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMlJbekRSm9p8zY.9TJnl3WKSK', 'superadmin') "
            "ON CONFLICT (username) DO NOTHING;\""
        )
        
        stdin, stdout, stderr = client.exec_command(sql_cmd)
        out = stdout.read().decode('utf-8', errors='replace').strip()
        err = stderr.read().decode('utf-8', errors='replace').strip()
        if out:
            print("Output:")
            print(out)
        if err:
            print("Error:")
            print(err)
            
        # Verify the user is inserted
        stdin, stdout, stderr = client.exec_command("docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"SELECT username, email, role FROM admin_users;\"")
        print("\nVerification of admin_users in teen_db_dev:")
        print(stdout.read().decode('utf-8', errors='replace').strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
