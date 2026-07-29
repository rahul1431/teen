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
        print("Connected to VPS. Fixing stale migration tracking rows...")
        
        # 1. Delete rows from schema_migrations
        filenames = "('060_deployment_tracking.sql', '061_deployment_access_control.sql', '061_deployment_rollback.sql', '062_deployment_environment.sql', '063_deployment_rollback_tracking.sql')"
        cmds = [
            f"docker exec -i teen_postgres psql -U teen -d teen_db -c \"DELETE FROM schema_migrations WHERE filename IN {filenames};\"",
            f"docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"DELETE FROM schema_migrations WHERE filename IN {filenames};\""
        ]
        for cmd in cmds:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            print(stdout.read().decode('utf-8', errors='replace').strip())
            
        # 2. Re-create migrate-dev.sh
        sftp = client.open_sftp()
        migrate_content = sftp.open("/opt/teen/infra/db/migrate.sh").read().decode('utf-8')
        dev_migrate_content = migrate_content.replace("-d teen_db", "-d teen_db_dev")
        f_dev = sftp.open("/opt/teen/infra/db/migrate-dev.sh", "w")
        f_dev.write(dev_migrate_content)
        f_dev.close()
        sftp.close()
        
        # 3. Re-run migrations
        cmds_run = [
            "chmod +x /opt/teen/infra/db/migrate-dev.sh",
            "bash /opt/teen/infra/db/migrate-dev.sh",
            "rm -f /opt/teen/infra/db/migrate-dev.sh",
            "bash /opt/teen/infra/db/migrate.sh"
        ]
        
        for cmd in cmds_run:
            print(f"\nExecuting: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out.strip())
            if err:
                print("ERROR:")
                print(err.strip())
                
        print("\nMigration sync logic completed.")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
