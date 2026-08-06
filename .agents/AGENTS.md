# Project Rules & Directives — MyOnlineJoker (teen)

## Direct VPS Access & Automatic Deployment Rule

1. **Direct VPS File Editing Capability**:
   - The AI assistant has full SSH and SFTP access to the production VPS (`64.204.130.181`).
   - The assistant can read, edit, update, patch, and deploy files directly on the live server directory at `/opt/teen-prod`.

2. **Mandatory Live VPS Synchronization**:
   - Whenever any backend code change, bug fix, database migration, or configuration update is made, the assistant MUST deploy the changes directly to the production VPS `/opt/teen-prod` (either via direct SFTP/SSH editing or via git push to `feature/admin-responsive` and running `python vps_run_deploy_v2.py`).
   - PM2 processes (`teen-core-api`, `teen-admin-svc`, `teen-gateway`, `teen-tp-engine`, `teen-ludo`, `teen-wallet`, etc.) must be reloaded immediately after applying backend changes.

3. **Database Migration Enforcement**:
   - Any SQL migration placed in `infra/db/migrations/` MUST be executed on the PostgreSQL database on the VPS (`teen_db`) using `bash infra/db/migrate.sh`.
