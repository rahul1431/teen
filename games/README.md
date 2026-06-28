# Games

Single source of truth for every game on the platform.

`registry.json` lists each game, its lifecycle status (`live` / `planned`),
the engine that powers it, player limits, bot support, and the path to its
tunable config under [`resources/game-configs/`](../resources/game-configs).

| Game | Type | Status | Engine |
|------|------|--------|--------|
| Teen Patti | multiplayer | live | `services/game-engines/teen-patti` (Go) |
| Aviator | solo crash | live | `services/game-engines/aviator` (Node) |
| Rummy | multiplayer | planned | `services/game-engines/rummy` |
| Ludo | multiplayer | planned | `services/game-engines/ludo` |

## Adding a new game

1. Add an entry to `registry.json`.
2. Create the engine under `services/game-engines/<id>/`.
3. Add a config file under `resources/game-configs/<id>.json`.
4. Register matchmaking/socket handlers in `services/game-gateway`.
5. Seed an admin-editable row in `game_configs` (see DB migrations).
