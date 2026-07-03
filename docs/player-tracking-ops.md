# Player Tracking — Ops

## GeoLite2 database
1. Create a free MaxMind account, generate a license key.
2. Download `GeoLite2-City.mmdb`, place at `/opt/teen/geoip/GeoLite2-City.mmdb`.
3. Ensure `GEOLITE2_CITY_PATH` points to it (set in ecosystem.config.js).
4. Restart: `pm2 restart app-monitor-service`. Without the file, IP-city is skipped (geo columns stay null); everything else works.
5. Refresh monthly (MaxMind updates the DB); a cron `geoipupdate` is recommended.

## Migration
Apply `infra/db/migrations/028_player_tracking.sql` before deploying the new services.

## Access
The Player Tracking admin page and its APIs require the `superadmin` role.

## Privacy / compliance
Precise GPS is opt-in per user (in-app consent). IP-city + device data collected for
security and regional compliance; disclose in the privacy policy (DPDP Act).
