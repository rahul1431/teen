# Login/Auth — Frontend

`admin-panel/src/pages/Login.tsx` (91 lines). Distinguishes "backend unreachable" (no `response.data` at all — CORS, network failure, wrong API URL) from "wrong credentials" (a proper error response), showing a distinct warning banner for the former with a pointer to `PROGRESS.md` — a thoughtful touch specifically because this admin panel can be built/served two different ways (VPS-deployed vs. GitHub Pages preview) with different API reachability, per `docs/admin-panel/app-update/frontend.md`'s notes on the same underlying multi-deployment-target issue.

2FA step reuses the same form: username/password fields disable (not hide) once `needs2fa` is true, and a 6-digit `totp_code` field appears.
