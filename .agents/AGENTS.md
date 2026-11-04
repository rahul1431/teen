# Project Rules & Directives — MyOnlineJoker (teen)

## Direct GCP Access & Automatic Deployment Rule

1. **Direct GCP Compute Engine Editing Capability**:
   - The AI assistant has full SSH and SFTP access to the production GCP VM (`35.244.3.210`) under user `rahulrathodloan3l` with key `C:/Users/Rahul/.ssh/id_ed25519`.
   - The assistant can read, edit, update, patch, and deploy files directly on the live server directory at `/opt/teen-prod`.

2. **Mandatory Live GCP Synchronization**:
   - Whenever any backend code change, bug fix, database migration, or configuration update is made, the assistant MUST deploy the changes directly to the production GCP server `/opt/teen-prod` (via `node scripts/sync-gcp-codebase.js` or direct SSH/SFTP sync).
   - PM2 processes (`teen-core-api`, `teen-admin-svc`, `teen-gateway`, `teen-tp-engine`, `teen-ludo`, `teen-wallet`, `teen-rummy`, `teen-aviator`, `teen-churn-ml`, `teen-bot-learning`, `teen-patti-bot-training`, `ludo-bot-training`) must be reloaded immediately after applying backend changes.

3. **Database Migration Enforcement**:
   - Any SQL migration placed in `infra/db/migrations/` MUST be executed on the PostgreSQL database on GCP (`teen_db`) using `sudo docker exec -i teen_postgres psql -U teen -d teen_db -f <migration>`.
