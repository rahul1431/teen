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
        
        cmds = [
            "docker ps",
            "docker exec -i teen_postgres psql -U teen -d teen_db -c '\\l'",
            "docker exec -i teen_postgres psql -U teen -d teen_db -c \"SELECT datname, count(*) FROM pg_stat_activity GROUP BY datname;\"",
            "docker exec -i teen_postgres psql -U teen -d teen_db -c \"SELECT tablename FROM pg_tables WHERE schemaname='public';\" | wc -l",
            "docker exec -i teen_postgres psql -U teen -d teen_db -c \"SELECT count(*) FROM pg_tables WHERE schemaname='public';\"",
            "docker exec -i teen_postgres psql -U teen -d teen_db_dev -c \"SELECT count(*) FROM pg_tables WHERE schemaname='public';\" || echo 'teen_db_dev not found or errored'",
        ]
        
        for cmd in cmds:
            print("="*60)
            print(f"Executing: {cmd}")
            print("="*60)
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode('utf-8', errors='replace')
            err = stderr.read().decode('utf-8', errors='replace')
            if out:
                print(out)
            if err:
                print("ERROR:")
                print(err)
            print("\n")

    except Exception as e:
        print(f"Failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
