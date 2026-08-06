---
name: vps-deploy-manager
description: Manage, deploy, migrate, and monitor production microservices on the MyOnlineJoker VPS (64.204.130.181 at /opt/teen-prod).
---

# VPS Deploy Manager Skill

Use this skill whenever deploying backend services, applying database migrations, reloading PM2 processes, or checking live Nginx configurations on the production VPS.

## Environment & Server Access
- **Host**: `64.204.130.181`
- **User**: `root`
- **Target Path**: `/opt/teen-prod`
- **Production URL**: `https://game.myonlinejoker.com`

## Standard Deployment Workflow

### 1. Code Push & Deploy Execution
To deploy changes from local repository to production:
```bash
git add .
git commit -m "your commit message"
git push origin HEAD:feature/admin-responsive
python vps_run_deploy_v2.py
```

### 2. Database Migrations
SQL migrations are stored sequentially in `infra/db/migrations/*.sql`.
To apply new migrations on the VPS database (`teen_db`):
```bash
python -c "
import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('64.204.130.181', username='root', password='<password>')
stdin, stdout, stderr = client.exec_command('cd /opt/teen-prod && bash infra/db/migrate.sh')
print(stdout.read().decode('utf-8'))
client.close()
"
```

### 3. PM2 Process Management
Managed services:
- `teen-core-api` (Port 3001)
- `teen-wallet` (Port 3003)
- `teen-gateway`, `teen-gateway-2`, `teen-gateway-3` (Port 3004)
- `teen-tp-engine` (Port 3010)
- `teen-ludo` (Port 3011)
- `teen-aviator` (Port 3005)
- `teen-admin-svc` (Port 3008)

To restart PM2 processes:
```bash
pm2 restart all --update-env
```
