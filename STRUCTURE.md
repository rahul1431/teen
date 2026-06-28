# Project Structure

A clean separation between **code**, **shared resources**, and **runtime data**.

```
teen/
├── services/                Backend microservices (Node.js) + game engines
│   ├── auth-service/        OTP, JWT, register/login
│   ├── user-service/        Profiles
│   ├── wallet-service/      Double-entry ledger, payments
│   ├── game-gateway/        Socket.IO matchmaking & rooms
│   ├── leaderboard-service/
│   ├── notification-service/ FCM push (uses resources/email-templates)
│   ├── admin-service/       Admin REST API + RBAC + audit log
│   ├── bot-engine/          (Python) per-game bot decisions
│   └── game-engines/        One folder per game
│       ├── teen-patti/      (Go)
│       └── aviator/         (Node)
│
├── admin-panel/             React + Ant Design Pro web admin
├── mobile/                  Flutter app (Android + iOS)
│
├── games/                   ── GAMES ──
│   ├── registry.json        Single source of truth for all games
│   └── README.md
│
├── resources/               ── SHARED STATIC RESOURCES (version-controlled) ──
│   ├── game-configs/        Default per-game tunables (seed game_configs)
│   ├── email-templates/     HTML email templates ({{placeholder}} tokens)
│   ├── card-assets/         Card metadata for Teen Patti / Rummy
│   └── docs/                Schemas & reference docs
│
├── uploads/                 ── RUNTIME USER CONTENT (gitignored content) ──
│   ├── avatars/             Profile pictures
│   ├── kyc/                 KYC docs (PII — blocked from public Nginx)
│   ├── banners/             Promo banners
│   └── game-assets/         Uploaded per-game assets
│
└── infra/                   Docker, Nginx, DB migrations, deploy scripts
```

## Why three top-level buckets?

| Bucket | Lifecycle | Committed? | Served at |
|--------|-----------|-----------|-----------|
| `games/` | definition / catalog | ✅ yes | n/a (config) |
| `resources/` | static, reviewed assets | ✅ yes | `/resources/` |
| `uploads/` | runtime user data | ❌ content ignored | `/uploads/` (KYC blocked) |
