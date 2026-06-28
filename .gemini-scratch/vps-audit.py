import paramiko, sys, io, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def ssh_exec(cmd):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect('64.204.130.181', username='root', password='4sXWo02f4WkNm8fM', timeout=15)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    client.close()
    return out, err

# 1. System info
print("=" * 60)
print("VPS SYSTEM INFO")
print("=" * 60)
out, _ = ssh_exec("uname -a && echo '---' && uptime && echo '---' && free -h && echo '---' && df -h /")
print(out)

# 2. /opt/teen structure (services only)
print("=" * 60)
print("/opt/teen SERVICES STRUCTURE")
print("=" * 60)
out, _ = ssh_exec("find /opt/teen/services -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' | sort")
print(out)

# 3. PM2 processes
print("=" * 60)
print("PM2 PROCESSES")
print("=" * 60)
out, _ = ssh_exec("pm2 jlist 2>/dev/null")
try:
    procs = json.loads(out)
    for p in procs:
        name = p.get('name', '?')
        status = p['pm2_env']['status']
        restarts = p['pm2_env']['restart_time']
        mem = round(p['monit']['memory'] / 1024 / 1024, 1)
        cpu = p['monit']['cpu']
        pid = p.get('pid', '?')
        port = p['pm2_env'].get('env', {}).get('PORT', '?')
        print(f"  {name:25s}  status={status:10s}  pid={pid:<8}  restarts={restarts:<4}  mem={mem}MB  cpu={cpu}%")
except:
    print("  (pm2 not running or empty)")
    print(out[:500])

# 4. Docker containers
print()
print("=" * 60)
print("DOCKER CONTAINERS")
print("=" * 60)
out, _ = ssh_exec("docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null")
print(out)

# 5. Nginx config / active sites
print("=" * 60)
print("NGINX / HESTIA DOMAIN CONFIG")
print("=" * 60)
out, _ = ssh_exec("ls -la /home/admin/conf/web/game.myonlinejoker.com/ 2>/dev/null || echo 'No hestia config found'")
print(out)

# 6. Listening ports
print("=" * 60)
print("LISTENING PORTS (relevant)")
print("=" * 60)
out, _ = ssh_exec("ss -tlnp | grep -E '(300[0-9]|301[0-2]|5432|6379|8080|80|443)' | sort")
print(out)

# 7. Service .env files exist?
print("=" * 60)
print("SERVICE .ENV FILES")
print("=" * 60)
out, _ = ssh_exec("for d in auth-service user-service wallet-service game-gateway admin-service notification-service leaderboard-service betting-service; do if [ -f /opt/teen/services/$d/.env ]; then echo \"  $d/.env EXISTS\"; else echo \"  $d/.env MISSING\"; fi; done && for d in aviator ludo; do if [ -f /opt/teen/services/game-engines/$d/.env ]; then echo \"  game-engines/$d/.env EXISTS\"; else echo \"  game-engines/$d/.env MISSING\"; fi; done")
print(out)

# 8. dist/ build status
print("=" * 60)
print("BUILD STATUS (dist/ dirs)")
print("=" * 60)
out, _ = ssh_exec("for d in auth-service user-service wallet-service game-gateway admin-service notification-service leaderboard-service betting-service; do if [ -d /opt/teen/services/$d/dist ]; then echo \"  $d/dist/ EXISTS\"; else echo \"  $d/dist/ MISSING\"; fi; done && for d in aviator ludo; do if [ -d /opt/teen/services/game-engines/$d/dist ]; then echo \"  game-engines/$d/dist/ EXISTS\"; else echo \"  game-engines/$d/dist/ MISSING\"; fi; done && echo '' && if [ -d /opt/teen/admin-panel/dist ]; then echo '  admin-panel/dist/ EXISTS'; else echo '  admin-panel/dist/ MISSING'; fi && echo '' && if [ -f /opt/teen/services/game-engines/teen-patti/teen-patti-engine ]; then echo '  teen-patti-engine binary EXISTS'; else echo '  teen-patti-engine binary MISSING'; fi")
print(out)

# 9. Git status
print("=" * 60)
print("GIT STATUS")
print("=" * 60)
out, _ = ssh_exec("cd /opt/teen && git branch --show-current && git log --oneline -5 && echo '---' && git status --short | head -10")
print(out)
