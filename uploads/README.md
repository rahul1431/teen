# Uploads

Runtime, user-generated file storage. **Content here is NOT committed** — only
the directory layout (via `.gitkeep`) is tracked. On the VPS this directory is
served read-only by Nginx at `/uploads/` and written to by the backend
services.

```
uploads/
├── avatars/      User profile pictures (set via PUT /users/me).
├── kyc/          KYC documents — PAN / Aadhaar images. Restricted access.
├── banners/      Promotional banners managed from the Admin Panel.
└── game-assets/  Per-game uploaded assets (custom table themes, etc).
```

## Configuration

Backend services resolve this path from the `UPLOAD_DIR` env var
(default `/opt/teen/uploads`). Nginx serves it via the `/uploads/` location
in `infra/nginx/hestia-proxy.conf`.

> ⚠️ KYC documents contain PII. The `/uploads/kyc/` path is blocked from
> public Nginx access and only reachable through authenticated admin APIs.
