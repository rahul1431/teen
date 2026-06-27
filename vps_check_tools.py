import paramiko

host = "64.204.130.181"
user = "root"
pw = "4sXWo02f4WkNm8fM"

def run_commands():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, username=user, password=pw)
        print(f"Connected to {host}")

        commands = [
            "node -v",
            "npm -v",
            "go version",
            "docker -v",
            "pm2 -v",
            "nginx -v",
            "certbot --version"
        ]

        for cmd in commands:
            stdin, stdout, stderr = client.exec_command(cmd)
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            print(f"{cmd}: {out if out else 'ERROR/MISSING'} {err}")

    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_commands()
