param([string]$Cmd)
$env:SSHPASS = "4sXWo02f4WkNm8fM"
# Try using ssh with key-based if available, otherwise we need sshpass
# On Windows, let's use Python's paramiko as a fallback
$pythonScript = @"
import paramiko, sys
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('64.204.130.181', username='root', password='4sXWo02f4WkNm8fM', timeout=10)
stdin, stdout, stderr = client.exec_command(sys.argv[1] if len(sys.argv) > 1 else 'echo connected')
print(stdout.read().decode(), end='')
err = stderr.read().decode()
if err:
    print(err, file=sys.stderr, end='')
client.close()
"@
python -c $pythonScript $Cmd
