import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def ssh_exec(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('64.204.130.181', username='root', password='4sXWo02f4WkNm8fM', timeout=15)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end='')
    if err:
        print(err, end='')
    client.close()

cmd = ' && '.join(sys.argv[1:]) if len(sys.argv) > 1 else 'echo connected'
ssh_exec(cmd)
