# Resources

Static, version-controlled assets shared across services. Unlike
[`uploads/`](../uploads) (runtime user content), everything here is part of
the repo and reviewed through pull requests.

```
resources/
├── game-configs/      Default tunables per game (rake, stakes, bot rules).
│                      Seeded into the `game_configs` table; admins override
│                      live values from the Admin Panel.
├── email-templates/   HTML templates (welcome, OTP, …) consumed by the
│                      notification service. Use {{placeholder}} tokens.
├── card-assets/       Card face / suit artwork metadata for Teen Patti & Rummy.
└── docs/              Schemas and reference docs (e.g. game-registry schema).
```
