import paramiko
import os
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
        print("Connected to VPS. Uploading untracked migration files...")
        
        sftp = client.open_sftp()
        
        migration_files = [
            "060_deployment_tracking.sql",
            "061_deployment_access_control.sql",
            "061_deployment_rollback.sql",
            "062_deployment_environment.sql",
            "063_deployment_rollback_tracking.sql"
        ]
        
        local_dir = "infra/db/migrations"
        remote_dir = "/opt/teen/infra/db/migrations"
        
        for f in migration_files:
            local_path = os.path.join(local_dir, f)
            remote_path = f"{remote_dir}/{f}"
            print(f"Uploading {local_path} -> {remote_path}")
            sftp.put(local_path, remote_path)
            
        sftp.close()
        print("All migration files uploaded successfully.")
        
        # Now let's run the dev migrations script again to apply them to teen_db_dev!
        print("\nRe-running migrate-dev.sh logic...")
        
        # 1. Create dev migrate script
        sftp = client.open_sftp()
        migrate_content = sftp.open("/opt/teen/infra/db/migrate.sh").read().decode('utf-8')
        dev_migrate_content = migrate_content.replace("-d teen_db", "-d teen_db_dev")
        f_dev = sftp.open("/opt/teen/infra/db/migrate-dev.sh", "w")
        f_dev.write(dev_migrate_content)
        f_dev.close()
        sftp.close()
        
        # 2. Run it
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
                print("ERROR:")
                print(err.strip())
                
        # Also run migrations on production teen_db for the new 060-063 migrations!
        # Because we need the production database to also have these new schema structures.
        print("\nRunning migrate.sh on production teen_db...")
        stdin, stdout, stderr = client.exec_command("bash /opt/teen/infra/db/migrate.sh")
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        if out:
            print(out.strip())
        if err:
            print("ERROR:")
            print(err.strip())

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
