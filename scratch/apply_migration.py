import paramiko

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def apply_mig():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print("Connected to VPS. Running migration manually to capture errors...")
        cmd = "docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen/infra/db/migrations/035_seo_and_marketing.sql"
        stdin, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        print("STDOUT:")
        print(out)
        print("STDERR:")
        print(err)
    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    apply_mig()
