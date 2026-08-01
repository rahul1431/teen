# Bot intelligence

How the Teen Patti and Ludo bots decide, after the per-game bot split.

Neither bot is ML or an LLM. Both are hand-written policies with a small number
of dials learned from human play. What changed is that the policies now look at
the actual game position instead of drawing from a fixed distribution.

## Teen Patti — `services/game-engines/teen-patti/bot.go`

The brain lives in the Go engine because that is the only process that can see
the bot's cards; the gateway holds redacted state. The gateway calls
`POST /bot/decide` with the trained profile and gets back an action, an amount,
and diagnostics (`strength`, `win_prob`, `reason`).

**Hand strength** (`strength.go`) is an exact percentile. All 22,100 possible
three-card hands are enumerated once at startup and scored with the same
`evaluateHand()` the showdown uses, so a hand's strength is literally the
fraction of hands it beats. Muflis mirrors it. Wild variations (AK47, Joker) are
evaluated with wilds applied and read off the classic distribution, which is
slightly optimistic — opponents hold wilds too.

**The decision:**

| Input | Effect |
|---|---|
| `strength ^ opponents` | probability this hand is the best at the table |
| `callCost / (pot + callCost)` | break-even probability the price demands |
| ratio of the two | tilts the trained fold/call/raise weights |
| `aggression` | scales how hard the tilt bends, bluff rate, raise sizing |

The comparison is a **ratio**, not a difference: in a big pot the price might
only demand 2%, which caps the worst possible difference at −0.02 and makes a
hopeless hand read as nearly break-even.

Call weight shrinks as conviction grows in either direction, and the mass goes
to whichever side the tilt points. Leaving it fixed was the first version's bug —
with a wide call band most draws landed on call regardless of the cards.

**Behaviours layered on top:**

- **Blind play uses no card knowledge at all.** A blind player has not looked;
  the policy must not either. A blind bot decides whether to *see* (chance rises
  with the round, falls with aggression) and otherwise plays its profile
  straight — exactly the pre-upgrade behaviour. `TestBlindBotIgnoresItsCards`
  pins this.
- **Never folds the nuts** (`winProb > 0.9` forces fold weight to zero).
- **Slow-plays a monster** 25% of the time, so raising isn't a perfect tell.
- **Bluffs** weak hands into small fields, rate scaled by aggression.
- **Calls for a show** heads-up with a big edge.
- **Raise size scales with the edge**, clamped to the table maximum.

## Ludo — `services/game-engines/ludo/src/rules.ts`

`chooseBotToken` used to be a fixed cascade: capture → safe move → advance the
most-progressed token. A fixed priority order can only express one strategy, and
it had two concrete blind spots — it never spent a 6 opening a token from base
(the most-progressed token was always already on the track, so bots played most
of a game with one token out), and it never valued *finishing*, so it would
decline an exact roll home to advance a different token one square.

It is now a scored evaluation of every legal move (`scoreBotMove`):

| Term | Weight |
|---|---|
| reach home | 100 |
| capture | 80 + 0.6 × how far that token had come |
| enter from base | 60 |
| enter home column (past cell 50) | 40 |
| land on a safe cell | 25 × safetyWeight |
| form a blockade with own token | 15 × safetyWeight |
| progress | 0.12 × new progress |
| change in exposure | −Δrisk × (20 + 0.5 × progress) × safetyWeight |

Exposure is priced as the **change**, not the level: scoring the destination
alone punishes a token for standing somewhere dangerous when every reachable
square is equally dangerous, and gives no credit for stepping out of range.
Threat probability is `1 − (5/6)^n` for `n` opponent tokens 1–6 cells behind.

### The trained dials

Both keep the load-bearing NULL semantics — **null means "no trained data, use
the deterministic default", never a number**:

- `capture_probability` — how often a real player takes an available capture.
  Rolled once per turn, not per candidate. Declining removes capturing moves
  from consideration so the bot picks the best *non*-capturing move rather than
  a random one, and never drops them if that would forfeit the turn.
- `safe_play_probability` — becomes `safetyWeight`, scaling every safety term
  together. Gating safe-cell seeking and exposure avoidance as one dial is what
  lets the trained number mean a single coherent thing.

Defaults when untrained: easy 0, medium 0.35, hard 1 — preserving the old shape
where hard was the only tier that considered exposure.

`easy` still plays a random legal move 80% of the time, so new players can win.
