package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"net/http"
)

// Teen Patti bot brain.
//
// This decision used to live in game-gateway (pickBotAction in
// src/bot-profile.ts), which meant the component choosing a bot's action was
// the one component that cannot see the bot's cards — the gateway holds
// redacted state, this engine holds the deal. The bot therefore bet identically
// with a trail and with 7-high. Moving the decision here puts it where the
// cards are, alongside Ludo's brain which already lives in its own engine.
//
// The gateway still owns turn orchestration and the human-like delay; it calls
// this endpoint to ask *what* to do, not *when*. The trained profile arrives in
// the request because the profile service (services/bot-training/teen-patti) is
// Node and is already on the gateway's path — adding an HTTP client and cache
// here would duplicate that for no gain.
//
// Behaviour is deliberately identical to the gateway's pickBotAction for now:
// a uniform draw against the three probabilities. Hand-strength conditioning is
// the next change and is intentionally separate, so that a behaviour shift
// cannot hide inside a structural move.

type botDecideRequest struct {
	RoomID string `json:"room_id"`
	UserID string `json:"user_id"`
	// Trained rates for this bot's difficulty tier, from
	// teen_patti_bot_profiles. They must sum to roughly 1; see clampProfile.
	FoldProbability  float64 `json:"fold_probability"`
	CallProbability  float64 `json:"call_probability"`
	RaiseProbability float64 `json:"raise_probability"`
}

type botDecideResponse struct {
	Action string  `json:"action"`
	Amount float64 `json:"amount"`
}

// pickBotAction draws an action from the profile's distribution.
//
// The bands are cumulative, so a profile whose three rates sum to less than 1
// leaves a gap that falls through to "raise" — matching the gateway's original
// behaviour exactly rather than quietly normalising, which would change live
// bot aggression the moment this shipped.
func pickBotAction(foldP, callP float64, roll float64) string {
	if roll < foldP {
		return "fold"
	}
	if roll < foldP+callP {
		return "call"
	}
	return "raise"
}

// botRaiseAmount mirrors what the gateway used to compute: double the minimum
// bet. It is clamped to the table maximum here, which the gateway could not do
// — it does not know PotLimit/NoLimit — so an over-cap raise used to come back
// as a 400 and cost the bot its turn.
func botRaiseAmount(state *GameState) float64 {
	amount := state.MinBet * 2
	limit := state.PotLimit
	if limit <= 0 && !state.NoLimit {
		limit = potLimitFor(state.Stake)
	}
	if max := maxRaiseFor(state.Stake, state.Pot, limit, state.NoLimit); amount > max {
		return max
	}
	return amount
}

// legalBotAction downgrades an action the table will reject, so a bot never
// forfeits a turn to a 400. A raise below the seen/blind minimum becomes a
// call; the gateway had no way to check either bound.
func legalBotAction(state *GameState, p *Player, action string, amount float64) (string, float64) {
	if action != "raise" {
		return action, state.MinBet
	}
	minimum := state.MinBet
	if p.IsSeen {
		minimum = state.MinBet * 2
	}
	if amount < minimum {
		return "call", state.MinBet
	}
	return "raise", amount
}

// decideBotAction is the whole brain: load state, verify it really is this
// bot's turn, draw an action, and make it legal.
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

	action := pickBotAction(req.FoldProbability, req.CallProbability, rand.Float64())
	amount := state.MinBet
	if action == "raise" {
		amount = botRaiseAmount(&state)
	}
	action, amount = legalBotAction(&state, p, action, amount)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(botDecideResponse{Action: action, Amount: amount})
}
