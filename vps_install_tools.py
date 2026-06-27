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
            "apt-get update",
            "apt-get install -y wget certbot python3-certbot-nginx",
            # Go 1.22 installation
            "wget -q https://go.dev/dl/go1.22.5.linux-amd64.tar.gz",
            "rm -rf /usr/local/go && tar -C /usr/local -xzf go1.22.5.linux-amd64.tar.gz",
            "ln -sf /usr/local/go/bin/go /usr/bin/go",
            "go version"
        ]

        for cmd in commands:
            print(f"Executing: {cmd}")
            stdin, stdout, stderr = client.exec_command(cmd)
            # Use channel to wait for command to finish properly
            exit_status = stdout.channel.recv_exit_status()
            out = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            print(f"Result ({exit_status}): {out}")
            if err: print(f"ERROR: {err}")

    except Exception as e:
        print(f"Connection failed: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    run_commands()
