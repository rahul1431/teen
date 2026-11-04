---
name: gcp-deploy-manager
description: Manage, deploy, migrate, and monitor production microservices on the MyOnlineJoker GCP Compute Engine instance (35.244.3.210 at /opt/teen-prod).
---

# GCP Deploy Manager Skill

Use this skill whenever deploying backend services, applying database migrations, reloading PM2 processes, or checking live services on the production Google Cloud Platform (GCP) Compute Engine instance.

## Environment & Server Access
- **Provider**: Google Cloud Platform (GCP)
- **Project ID**: `my-online-joker`
- **Host / External IP**: `35.244.3.210`
- **User**: `rahulrathodloan3l`
- **SSH Key**: `C:/Users/Rahul/.ssh/id_ed25519`
- **Target Path**: `/opt/teen-prod`
- **Production URL**: `https://game.myonlinejoker.com`
- **Docker Containers**: `teen_postgres` (PostgreSQL 16), `teen-redis` (Redis 7), `roundcube`

## Standard Deployment Workflow

### 1. Code Sync & Deployment
To deploy changes from local repository to GCP:
```bash
node scripts/sync-gcp-codebase.js
```
This script packages the workspace, uploads it over SFTP, unpackages into `/opt/teen-prod/`, rebuilds services, and restarts PM2.

### 2. Database Migrations
SQL migrations are stored sequentially in `infra/db/migrations/*.sql`.
To apply new migrations on the GCP database (`teen_db`):
```bash
sudo docker exec -i teen_postgres psql -U teen -d teen_db -f infra/db/migrations/<migration_file>.sql
```

### 3. PM2 Process Management
Managed microservices:
- `teen-core-api` (Port 3001)
- `teen-wallet` (Port 3003)
- `teen-gateway`, `teen-gateway-2`, `teen-gateway-3` (Port 3004)
- `teen-tp-engine` (Port 3010)
- `teen-ludo` (Port 3011)
- `teen-rummy` (Port 3012)
- `teen-aviator` (Port 3005)
- `teen-admin-svc` (Port 3008 / 3011)
- `teen-churn-ml` (Port 3020)
- `teen-patti-bot-training` (Port 3023)
- `ludo-bot-training` (Port 3024)
- `teen-bot-learning` (Port 3014)

To restart PM2 processes:
```bash
pm2 restart all --update-env
```
