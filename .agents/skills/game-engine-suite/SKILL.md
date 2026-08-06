---
name: game-engine-suite
description: Automated test execution and verification suite for Teen Patti (Go), Ludo, Aviator, and Rummy game engines.
---

# Game Engine Suite Skill

Use this skill when testing or modifying game logic, card evaluation rules, dice rolls, crash curves, or bot behavior.

## Engine Test Commands

### 1. Teen Patti (Go Engine)
Path: `services/game-engines/teen-patti`
- Run all tests: `go test ./...`
- Run hand evaluator tests: `go test -run TestEvaluateHand ./...`
- Test Muflis (lowest card wins): `go test -run TestMuflis ./...`
- Test AK47 wild card evaluator: `go test -run TestAK47 ./...`

### 2. Ludo Engine (Node/TS)
Path: `services/game-engines/ludo`
- Run unit/integration tests: `npm test`
- Board safe cell verification: `{0, 8, 13, 21, 26, 34, 39, 47}`.

### 3. Aviator Engine (Node/TS)
Path: `services/game-engines/aviator`
- RNG Crash formula validation: `0.97 / (1 - r)`.
