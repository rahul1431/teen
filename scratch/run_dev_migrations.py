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
        print("Connected to VPS. Running Step 2: Synchronize teen_db_dev schema...")
        
        # 1. Create a copy of the migrate script targeting teen_db_dev
        sftp = client.open_sftp()
        try:
            migrate_content = sftp.open("/opt/teen/infra/db/migrate.sh").read().decode('utf-8')
            dev_migrate_content = migrate_content.replace("-d teen_db", "-d teen_db_dev")
            
            f_dev = sftp.open("/opt/teen/infra/db/migrate-dev.sh", "w")
            f_dev.write(dev_migrate_content)
            f_dev.close()
            print("Created /opt/teen/infra/db/migrate-dev.sh successfully.")
        except Exception as e:
            print(f"Error copying migration script: {e}")
            return
        finally:
            sftp.close()
            
        # 2. Make it executable and run it
        cmds = [
            "chmod +x /opt/teen/infra/db/migrate-dev.sh",
            "bash /opt/teen/infra/db/migrate-dev.sh",
            "rm -f /opt/teen/infra/db/migrate-dev.sh"
        ]
        
        for cmd in cmds:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR/STDERR:")
                print(err.strip())
                
        print("\nStep 2 completed successfully.")

    except Exception as e:
        print(f"Step 2 failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
