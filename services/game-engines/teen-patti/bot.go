package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
)

// Teen Patti bot brain.
//
// This decision used to live in game-gateway (pickBotAction in
// src/bot-profile.ts), which meant the component choosing a bot's action was
// the one component that cannot see the bot's cards — the gateway holds
// redacted state, this engine holds the deal. The bot therefore bet identically
// with a trail and with 7-high. Moving the decision here put it where the cards
// are; this file is what that move was *for*.
//
// The gateway still owns turn orchestration and the human-like delay; it calls
// this endpoint to ask *what* to play, not *when*. The trained profile arrives
// in the request because the profile service (services/bot-training/teen-patti)
// is Node and is already on the gateway's path — adding an HTTP client and
// cache here would duplicate that for no gain.
//
// The trained profile is still the baseline: it sets how loose or aggressive
// this difficulty tier is, and admin edits to it still move the needle. What
// the profile no longer does is decide alone. It is now *tilted* by the hand,
// the price, and the field — see decideBot below.

type botDecideRequest struct {
	RoomID string `json:"room_id"`
	UserID string `json:"user_id"`
	// Trained rates for this bot's difficulty tier, from
	// teen_patti_bot_profiles.
	FoldProbability  float64 `json:"fold_probability"`
	CallProbability  float64 `json:"call_probability"`
	RaiseProbability float64 `json:"raise_probability"`
	// 0..1. Scales how hard the hand tilts the trained rates, how often the bot
	// bluffs, and how much it over-bets a strong hand. A 0 aggression bot plays
	// its profile almost straight.
	Aggression float64 `json:"aggression"`
}

type botDecideResponse struct {
	Action string  `json:"action"`
	Amount float64 `json:"amount"`
	// Diagnostics for the caller. Nothing consumes these yet; they exist because
	// "why did that bot fold" is otherwise unanswerable after the fact — the
	// action alone cannot distinguish a value fold from a bluff that didn't fire.
	Strength float64 `json:"strength"`
	WinProb  float64 `json:"win_prob"`
	Reason   string  `json:"reason"`
}

// botSituation is everything the policy is allowed to know. Keeping it a plain
// struct rather than reaching into GameState is what makes decideBot a pure
// function, and therefore testable without Redis or a dealt game.
type botSituation struct {
	// Percentile strength of the bot's own hand, 0..1. Only meaningful once
	// IsSeen — a blind player has genuinely not looked at their cards, and the
	// policy must not cheat by peeking. See decideBot.
	strength   float64
	opponents  int     // active players other than this bot
	callCost   float64 // what calling costs right now
	pot        float64
	round      int
	isSeen     bool
	canShow    bool // exactly two players left, so "show" is legal
	aggression float64
	foldP      float64
	callP      float64
	raiseP     float64
	minBet     float64
}

// rolls carries the random draws a decision needs, so tests can pin them.
// Named fields rather than a slice because "rolls[2]" in a test says nothing
// about what it controls.
type botRolls struct {
	action float64 // the main fold/call/raise draw
	see    float64 // whether a blind bot looks at its cards
	bluff  float64 // whether a weak hand raises anyway
	trap   float64 // whether a monster hand slow-plays
	show   float64 // whether a strong heads-up hand calls for a show
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

// pickBotAction draws an action from a three-way distribution.
//
// The bands are cumulative and the caller is responsible for the weights
// summing to 1 — normaliseWeights guarantees that. Anything left over falls
// through to "raise", which is only reachable on a degenerate all-zero profile.
func pickBotAction(foldP, callP float64, roll float64) string {
	if roll < foldP {
		return "fold"
	}
	if roll < foldP+callP {
		return "call"
	}
	return "raise"
}

// normaliseWeights turns three non-negative weights into a distribution.
//
// The trained rates historically did not sum to 1, and the old code left the
// shortfall on "raise" as an accident of cumulative bands. Now that the weights
// get multiplied by a tilt, that accident would silently change aggression
// whenever the tilt moved, so the shortfall is made explicit *before* tilting
// (see tiltedWeights) and the result is normalised honestly here.
func normaliseWeights(fold, call, raise float64) (float64, float64, float64) {
	fold, call, raise = math.Max(0, fold), math.Max(0, call), math.Max(0, raise)
	total := fold + call + raise
	if total <= 0 {
		return 0, 1, 0 // no information: call, the least destructive action
	}
	return fold / total, call / total, raise / total
}

// tiltedWeights bends the trained profile toward the hand the bot is holding.
//
// winProb is the chance of holding the best hand at the table; potOdds is the
// break-even chance the price demands.
//
// The comparison is a *ratio*, not a difference. Subtracting them looks natural
// but is badly behaved: in a big pot the price might only demand 2%, which caps
// the worst possible difference at -0.02 and leaves a hopeless hand reading as
// almost break-even. The ratio says what a player actually says — "I need 17%
// and I have 5%, that's a third of the price" — and behaves the same whether
// the pot is tiny or huge.
//
// Aggression scales how hard the ratio bends the profile: a timid tier still
// folds decent hands, an aggressive one presses thin edges.
//
// The trained rates set the starting point, so an admin who makes "hard" looser
// still sees a looser bot; the hand only moves it from there.
func tiltedWeights(s botSituation, winProb, potOdds float64) (float64, float64, float64) {
	// Give the profile's shortfall to raise explicitly, matching what the old
	// cumulative bands did implicitly, so tilting starts from the same place
	// live bots were already at.
	raise := math.Max(s.raiseP, 1-s.foldP-s.callP)

	signal := 1.0 // free money; only reachable if the price is somehow zero
	if potOdds > 0 {
		signal = clamp(winProb/potOdds-1, -1, 1)
	}
	tilt := clamp(signal*(0.6+0.8*s.aggression), -1, 1)

	// Call is the "no strong opinion" action, so its weight shrinks as
	// conviction grows in *either* direction, and the mass it gives up goes to
	// whichever side the tilt points. Leaving call fixed was the original bug
	// here: with a wide call band, most draws landed on call no matter what the
	// bot was holding, and the hand may as well not have been read.
	conviction := math.Abs(tilt)
	fold := s.foldP * (1 - tilt)
	raise = raise * (1 + tilt)
	call := s.callP * (1 - 0.5*conviction)
	if tilt < 0 {
		fold += s.callP * conviction * 0.5
	} else {
		raise += s.callP * conviction * 0.5
	}

	// A hand this strong is not a folding hand at any price this game can
	// charge. Without this floor a trail still folds at the profile's base rate,
	// which is the single most obviously non-human thing a bot can do.
	if winProb > 0.9 {
		fold = 0
	}

	return normaliseWeights(fold, call, raise)
}

// decideBot is the policy. Pure: same situation and same rolls, same answer.
func decideBot(s botSituation, r botRolls) (action string, amount float64, reason string) {
	// --- Blind play -------------------------------------------------------
	//
	// A blind player has not looked at their cards, so neither may the policy.
	// Using strength here would be the bot playing cards it hasn't seen, which
	// is both unfair and — because it would bet blind hands with uncanny
	// accuracy — the most detectable form of cheating there is.
	//
	// What a blind bot decides instead is whether to look. Humans mostly go a
	// round or two blind (it's half price) and then see; aggressive players ride
	// blind longer because the discount is the whole point.
	if !s.isSeen {
		seeChance := clamp(0.20*float64(s.round)-0.10*s.aggression, 0, 0.85)
		if r.see < seeChance {
			return "see", 0, "looked at cards"
		}
		// Still blind: play the trained profile straight, which is exactly the
		// behaviour that was live before this file learned about hands.
		fold, call, _ := normaliseWeights(s.foldP, s.callP, math.Max(s.raiseP, 1-s.foldP-s.callP))
		act := pickBotAction(fold, call, r.action)
		return act, blindAmount(s, act), "blind, profile draw"
	}

	// --- Seen play --------------------------------------------------------

	// Chance this hand is the best at the table. Treating opponents as
	// independent draws is the standard approximation and is close enough at
	// three-card depth: beating one random hand with probability p means
	// beating n of them with roughly p^n.
	opp := s.opponents
	if opp < 1 {
		opp = 1
	}
	winProb := math.Pow(s.strength, float64(opp))

	// What the price demands to break even.
	potOdds := 0.5
	if s.pot+s.callCost > 0 {
		potOdds = s.callCost / (s.pot + s.callCost)
	}

	// Show: heads-up with a hand that is very likely ahead, take the money now
	// rather than let a worse hand keep drawing chips out of position. Not
	// always — always-showing is itself a tell.
	if s.canShow && winProb > 0.80 && r.show < 0.5 {
		return "show", s.callCost, "strong heads-up, forcing showdown"
	}

	// Trap: a monster occasionally just calls, so that raising isn't a perfect
	// signal of strength. Without this, any observant human folds every time a
	// bot raises.
	if winProb > 0.90 && r.trap < 0.25 {
		return "call", s.callCost, "slow-playing a monster"
	}

	// Bluff: a weak hand raises into a small field. Rare, aggression-scaled, and
	// deliberately not attempted multi-way where it almost never works.
	if winProb < 0.35 && s.opponents <= 2 && r.bluff < 0.12*s.aggression {
		return "raise", raiseAmount(s, 1.0), "bluff"
	}

	fold, call, _ := tiltedWeights(s, winProb, potOdds)
	act := pickBotAction(fold, call, r.action)
	if act == "raise" {
		// Size the raise to the edge: a thin edge makes the minimum, a clear one
		// presses. Fixed-size raises are their own tell.
		edge := clamp((winProb-potOdds)*2, 0, 1)
		return act, raiseAmount(s, edge), "value raise"
	}
	return act, s.callCost, "profile tilted by hand"
}

// blindAmount is what a blind bot puts in. Blind stakes are half a seen
// player's, so the minimum bet is the call cost and the standard raise is 2x.
func blindAmount(s botSituation, action string) float64 {
	if action == "raise" {
		return s.minBet * 2
	}
	return s.minBet
}

// raiseAmount scales between the legal minimum raise and roughly double it,
// with aggression widening the top end.
func raiseAmount(s botSituation, edge float64) float64 {
	base := s.minBet * 2 // the seen player's minimum raise
	return base * (1 + clamp(edge, 0, 1)*(0.5+s.aggression))
}

// botRaiseAmount clamps a proposed raise to the table maximum. The gateway
// could not do this — it does not know PotLimit/NoLimit — so an over-cap raise
// used to come back as a 400 and cost the bot its turn.
func botRaiseAmount(state *GameState, proposed float64) float64 {
	limit := state.PotLimit
	if limit <= 0 && !state.NoLimit {
		limit = potLimitFor(state.Stake)
	}
	if max := maxRaiseFor(state.Stake, state.Pot, limit, state.NoLimit); proposed > max {
		return max
	}
	return proposed
}

// legalBotAction downgrades an action the table will reject, so a bot never
// forfeits a turn to a 400. A raise below the seen/blind minimum becomes a
// call; the gateway had no way to check either bound.
func legalBotAction(state *GameState, p *Player, action string, amount float64) (string, float64) {
	if action != "raise" {
		if action == "see" {
			return action, 0
		}
		if p.IsSeen {
			return action, state.MinBet * 2
		}
		return action, state.MinBet
	}
	minimum := state.MinBet
	if p.IsSeen {
		minimum = state.MinBet * 2
	}
	if amount < minimum {
		return "call", minimum
	}
	return "raise", amount
}

// decideBotAction is the whole brain: load state, verify it really is this
// bot's turn, build the situation, decide, and make the answer legal.
func (s *Server) decideBotAction(w http.ResponseWriter, r *http.Request) {
	var req botDecideRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", 400)
		return
	}

	ctx := context.Background()
	rawState, err := s.redis.Get(ctx, fmt.Sprintf("tp:game:%s", req.RoomID)).Bytes()
	if err != nil {
		http.Error(w, "game not found", 404)
		return
	}
	var state GameState
	if err := json.Unmarshal(rawState, &state); err != nil {
		http.Error(w, "corrupt game state", 500)
		return
	}

	playerIdx := -1
	for i := range state.Players {
		if state.Players[i].UserID == req.UserID {
			playerIdx = i
			break
		}
	}
	if playerIdx == -1 {
		http.Error(w, "player not in room", 404)
		return
	}
	p := &state.Players[playerIdx]

	// Refuse to decide for a human. This endpoint returns an action that the
	// caller then submits as that user — deciding for a real player would be
	// playing their money for them.
	if !p.IsBot {
		http.Error(w, "player is not a bot", 400)
		return
	}
	if state.CurrentTurn != playerIdx {
		http.Error(w, "not this player's turn", 409)
		return
	}
	if p.Status == "folded" {
		http.Error(w, "player has folded", 409)
		return
	}

	active := 0
	for i := range state.Players {
		if state.Players[i].Status != "folded" {
			active++
		}
	}

	callCost := state.MinBet
	if p.IsSeen {
		callCost = state.MinBet * 2
	}

	sit := botSituation{
		opponents:  active - 1,
		callCost:   callCost,
		pot:        state.Pot,
		round:      state.Round,
		isSeen:     p.IsSeen,
		canShow:    active == 2,
		aggression: clamp(req.Aggression, 0, 1),
		foldP:      req.FoldProbability,
		callP:      req.CallProbability,
		raiseP:     req.RaiseProbability,
		minBet:     state.MinBet,
	}
	// Only compute strength once the bot has actually looked. Guarding here as
	// well as in decideBot means a future caller cannot accidentally hand the
	// policy a blind hand's strength.
	if p.IsSeen {
		sit.strength = handStrength(state.Variation, state.JokerRank, p.Cards)
	}

	rolls := botRolls{
		action: rand.Float64(),
		see:    rand.Float64(),
		bluff:  rand.Float64(),
		trap:   rand.Float64(),
		show:   rand.Float64(),
	}

	action, amount, reason := decideBot(sit, rolls)
	if action == "raise" {
		amount = botRaiseAmount(&state, amount)
	}
	action, amount = legalBotAction(&state, p, action, amount)

	winProb := sit.strength
	if opp := sit.opponents; opp > 1 {
		winProb = math.Pow(sit.strength, float64(opp))
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(botDecideResponse{
		Action:   action,
		Amount:   amount,
		Strength: sit.strength,
		WinProb:  winProb,
		Reason:   reason,
	})
}
