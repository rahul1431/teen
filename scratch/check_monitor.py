import paramiko, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

c = paramiko.SSHClient(); c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('64.204.130.181', username='root', password='4sXWo02f4WkNm8fM')

def run(cmd):
    i, o, e = c.exec_command(cmd)
    return o.read().decode('utf-8', 'replace') + e.read().decode('utf-8', 'replace')

print('=== which process owns pid on 3017 ===')
print(run("ss -ltnp 2>/dev/null | grep 3017"))
print(run("for p in $(pm2 pid teen-monitoring teen-app-monitor 2>/dev/null); do echo pm2pid=$p; done; echo '--- cmdline of 3017 owner ---'; cat /proc/$(ss -ltnp 2>/dev/null | grep -oP '3017.*pid=\\K[0-9]+' | head -1)/cmdline 2>/dev/null | tr '\\0' ' '; echo"))

print('\n=== monitoring-service PORT + /ws endpoint? ===')
print(run("grep -iE 'port|3017' /opt/teen/services/monitoring-service/.env 2>&1 | head"))
print(run("grep -rnE '3017|/ws|WebSocketServer|new WebSocket.Server|upgrade' /opt/teen/services/monitoring-service/src/index.ts 2>/dev/null | head"))

print('=== app-monitor-service: does it expose /ws? ===')
print(run("grep -rnE '/ws|WebSocketServer|WebSocket.Server|upgrade|3017' /opt/teen/services/app-monitor-service/src/*.ts 2>/dev/null | head"))

print('\n=== is gateway STILL refusing 3017, or connected now? (last 40 gateway lines) ===')
print(run("pm2 logs teen-gateway --lines 40 --nostream 2>&1 | grep -iE 'monitor-emitter' | tail -8"))

print('=== live probe: can we reach ws path on 3017? (http upgrade headers) ===')
print(run("curl -s -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==' http://127.0.0.1:3017/ws --max-time 3 2>&1 | head -8"))

c.close()
