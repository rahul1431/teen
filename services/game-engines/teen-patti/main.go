package main

import (
	"context"
	cryptoRand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Card suits and values
const (
	Spades   = "S"
	Hearts   = "H"
	Diamonds = "D"
	Clubs    = "C"
)

var values = []string{"2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"}

type Card struct {
	Value string `json:"value"`
	Suit  string `json:"suit"`
	Rank  int    `json:"rank"` // 2=2, 14=A
}

type Player struct {
	UserID   string  `json:"user_id"`
	Username string  `json:"username"`
	Seat     int     `json:"seat"`
	IsBot    bool    `json:"is_bot"`
	Status   string  `json:"status"` // active, folded, all_in
	Cards    []Card  `json:"cards,omitempty"`
	Bet      float64 `json:"bet"`
	IsSeen   bool    `json:"is_seen"` // blind vs seen
}

type GameState struct {
	RoomID        string   `json:"room_id"`
	GameType      string   `json:"game_type"`
	Stake         float64  `json:"stake"`
	Players       []Player `json:"players"`
	Status        string   `json:"status"`
	CurrentTurn   int      `json:"current_turn"`
	Pot           float64  `json:"pot"`
	PotLimit      float64  `json:"pot_limit"`
	NoLimit       bool     `json:"no_limit"` // true = no pot cap (distinct from legacy PotLimit 0)
	Round         int      `json:"round"`
	MinBet        float64  `json:"min_bet"`
	DealerID      string   `json:"dealer_id"`
	CreatedAt     int64    `json:"created_at"`
	BotDifficulty string   `json:"bot_difficulty,omitempty"`
	// Variation: classic (default) / ak47 / no_limit / muflis / joker.
	Variation string `json:"variation,omitempty"`
	// Joker mode only: the rank (2..14) wild for this hand, and its display
	// value ("2".."A") so clients can announce it on the table.
	JokerRank  int    `json:"joker_rank,omitempty"`
	JokerValue string `json:"joker_value,omitempty"`
	// Set while a sideshow request awaits the target's accept/reject. The
	// requester's turn is frozen until it resolves (or the requester folds).
	PendingSideshow *SideshowState `json:"pending_sideshow,omitempty"`
}

type SideshowState struct {
	RequesterID string `json:"requester_id"`
	TargetID    string `json:"target_id"`
	RequestedAt int64  `json:"requested_at"`
}

// Hand ranks (higher = better)
const (
	HighCard      = 1
	Pair          = 2
	Color         = 3
	Sequence      = 4
	PureSequence  = 5
	Trail         = 6
)

type HandResult struct {
	Rank  int
	Cards []Card
	Score int // tiebreaker
}

func rankCard(value string) int {
	ranks := map[string]int{
		"2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
		"9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
	}
	return ranks[value]
}

func newDeck() []Card {
	deck := make([]Card, 0, 52)
	for _, suit := range []string{Spades, Hearts, Diamonds, Clubs} {
		for _, val := range values {
			deck = append(deck, Card{Value: val, Suit: suit, Rank: rankCard(val)})
		}
	}
	// Fisher-Yates shuffle using cryptographically secure source
	for i := len(deck) - 1; i > 0; i-- {
		nBig, err := cryptoRand.Int(cryptoRand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			panic(err)
		}
		j := nBig.Int64()
		deck[i], deck[j] = deck[j], deck[i]
	}
	return deck
}

func evaluateHand(cards []Card) HandResult {
	if len(cards) != 3 {
		return HandResult{Rank: HighCard}
	}

	ranks := make([]int, 3)
	for i, c := range cards {
		ranks[i] = c.Rank
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ranks)))

	sameSuit := cards[0].Suit == cards[1].Suit && cards[1].Suit == cards[2].Suit

	// Trail (Three of a kind)
	if ranks[0] == ranks[1] && ranks[1] == ranks[2] {
		return HandResult{Rank: Trail, Score: ranks[0] * 1000}
	}

	// Check sequence
	isSeq := (ranks[0]-ranks[1] == 1 && ranks[1]-ranks[2] == 1)
	isAce23 := (ranks[0] == 14 && ranks[1] == 3 && ranks[2] == 2) // A-2-3

	if isSeq || isAce23 {
		score := ranks[0]*100 + ranks[1]*10 + ranks[2]
		if isAce23 {
			// In many variations, A-2-3 is the highest sequence.
			// We give it a score higher than A-K-Q (14*100 + 13*10 + 12 = 1542)
			score = 1600
		}
		if sameSuit {
			return HandResult{Rank: PureSequence, Score: score}
		}
		return HandResult{Rank: Sequence, Score: score}
	}
	if sameSuit {
		return HandResult{Rank: Color, Score: ranks[0]*100 + ranks[1]*10 + ranks[2]}
	}

	// Pair
	if ranks[0] == ranks[1] {
		return HandResult{Rank: Pair, Score: ranks[0]*100 + ranks[2]}
	}
	if ranks[1] == ranks[2] {
		return HandResult{Rank: Pair, Score: ranks[1]*100 + ranks[0]}
	}

	return HandResult{Rank: HighCard, Score: ranks[0]*100 + ranks[1]*10 + ranks[2]}
}

func compareHands(a, b HandResult) int {
	if a.Rank != b.Rank {
		if a.Rank > b.Rank {
			return 1
		}
		return -1
	}
	if a.Score != b.Score {
		if a.Score > b.Score {
			return 1
		}
		return -1
	}
	return 0
}

// wildRanks returns the card ranks that act as jokers under a variation:
// AK47 fixes them to A/K/4/7; Joker mode uses the rank drawn at deal time.
func wildRanks(variation string, jokerRank int) map[int]bool {
	switch variation {
	case "ak47":
		return map[int]bool{14: true, 13: true, 4: true, 7: true}
	case "joker":
		if jokerRank > 0 {
			return map[int]bool{jokerRank: true}
		}
	}
	return nil
}

// compareHandsVariant orders two evaluated hands under a variation.
// Muflis (lowball) inverts the classic ranking: the worst classic hand wins.
func compareHandsVariant(variation string, a, b HandResult) int {
	c := compareHands(a, b)
	if variation == "muflis" {
		return -c
	}
	return c
}

// evaluateHandVariant evaluates a hand honoring the variation's wild cards:
// each joker is brute-forced over all 52 substitutions and the strongest
// resulting hand (under the variation's ordering) is kept. With no wilds it
// falls through to the classic evaluator.
func evaluateHandVariant(variation string, jokerRank int, cards []Card) HandResult {
	wilds := wildRanks(variation, jokerRank)
	if len(wilds) == 0 {
		return evaluateHand(cards)
	}
	wildIdx := []int{}
	for i, c := range cards {
		if wilds[c.Rank] {
			wildIdx = append(wildIdx, i)
		}
	}
	if len(wildIdx) == 0 {
		return evaluateHand(cards)
	}
	work := make([]Card, len(cards))
	copy(work, cards)
	var best HandResult
	haveBest := false
	var trySubstitutions func(k int)
	trySubstitutions = func(k int) {
		if k == len(wildIdx) {
			h := evaluateHand(work)
			if !haveBest || compareHandsVariant(variation, h, best) > 0 {
				best = h
				haveBest = true
			}
			return
		}
		i := wildIdx[k]
		orig := work[i]
		for _, suit := range []string{Spades, Hearts, Diamonds, Clubs} {
			for _, val := range values {
				work[i] = Card{Value: val, Suit: suit, Rank: rankCard(val)}
				trySubstitutions(k + 1)
			}
		}
		work[i] = orig
	}
	trySubstitutions(0)
	return best
}

func findBestHandIndex(players []Player, variation string, jokerRank int) int {
	bestIdx := -1
	var bestHand HandResult
	for i := range players {
		if players[i].Status == "folded" {
			continue
		}
		hand := evaluateHandVariant(variation, jokerRank, players[i].Cards)
		if bestIdx == -1 || compareHandsVariant(variation, hand, bestHand) > 0 {
			bestIdx = i
			bestHand = hand
		}
	}
	return bestIdx
}

type Server struct {
	db    *pgxpool.Pool
	redis *redis.Client
}

// /start and /action both do a load (or blind-write for /start) -> mutate ->
// save against Redis with no atomicity of their own. Two near-simultaneous
// /action calls for the same room (index.ts:541 explicitly allows out-of-turn
// see/sideshow_accept/sideshow_reject, and the bot-turn scheduler's retry path
// can overlap a human's own action) can otherwise both load the same state
// and the second Set silently clobbers the first. A short-lived Redis lock
// per room_id serializes those calls, mirroring the Ludo engine's
// withRoomLock (services/game-engines/ludo/src/index.ts).
const (
	lockTTL     = 5 * time.Second
	lockRetry   = 100 * time.Millisecond
	lockMaxWait = 3 * time.Second
)

var errRoomBusy = errors.New("room busy, try again")

func (s *Server) withRoomLock(ctx context.Context, roomID string, fn func() error) error {
	token := uuid.NewString()
	lockKey := fmt.Sprintf("tp:lock:%s", roomID)
	deadline := time.Now().Add(lockMaxWait)
	acquired := false
	for time.Now().Before(deadline) {
		ok, err := s.redis.SetNX(ctx, lockKey, token, lockTTL).Result()
		if err == nil && ok {
			acquired = true
			break
		}
		time.Sleep(lockRetry)
	}
	if !acquired {
		return errRoomBusy
	}
	defer func() {
		// Best-effort release only if we still hold it (avoid deleting a lock
		// acquired by someone else after our TTL expired).
		if cur, err := s.redis.Get(ctx, lockKey).Result(); err == nil && cur == token {
			s.redis.Del(ctx, lockKey)
		}
	}()
	return fn()
}

type StartGameReq struct {
	RoomID        string   `json:"room_id"`
	Players       []Player `json:"players"`
	Stake         float64  `json:"stake"`
	BotDifficulty string   `json:"bot_difficulty"`
	NoLimit       bool     `json:"no_limit"`  // no-limit tables have no pot cap
	Variation     string   `json:"variation"` // classic / ak47 / no_limit / muflis / joker
}

type ActionReq struct {
	RoomID     string  `json:"room_id"`
	UserID     string  `json:"user_id"`
	Action     string  `json:"action"` // call, raise, fold, show
	Amount     float64 `json:"amount"`
	SequenceNum int    `json:"sequence_num"`
}

type GameResult struct {
	WinnerID   string  `json:"winner_id"`
	Prize      float64 `json:"prize"`
	RakeFee    float64 `json:"rake_fee"`
	HandRank   string  `json:"hand_rank"`
	AllHands   []map[string]interface{} `json:"all_hands"`
}

func handRankName(rank int) string {
	names := map[int]string{
		HighCard: "High Card", Pair: "Pair", Color: "Color",
		Sequence: "Sequence", PureSequence: "Pure Sequence", Trail: "Trail",
	}
	return names[rank]
}

func (s *Server) startGame(w http.ResponseWriter, r *http.Request) {
	var req StartGameReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}

	variation := req.Variation
	if variation == "" {
		variation = "classic"
	}
	jokerRank := 0
	jokerValue := ""
	if variation == "joker" {
		// Draw this hand's wild rank (2..14 → "2".."A")
		nBig, err := cryptoRand.Int(cryptoRand.Reader, big.NewInt(13))
		if err == nil {
			jokerRank = int(nBig.Int64()) + 2
		} else {
			jokerRank = 7
		}
		jokerValue = values[jokerRank-2]
	}

	deck := newDeck()
	players := req.Players

	realPlayerCount := 0
	// Deal 3 cards to each player
	for i := range players {
		players[i].Cards = deck[i*3 : i*3+3]
		players[i].Status = "active"
		players[i].IsSeen = false
		players[i].Bet = req.Stake
		if !players[i].IsBot {
			realPlayerCount++
		}
	}

	botDifficulty := req.BotDifficulty
	if botDifficulty == "" {
		botDifficulty = "medium"
	}

	winRateTarget := 50.0 // default
	if s.db != nil {
		var target float64
		err := s.db.QueryRow(context.Background(),
			`SELECT win_rate_target FROM bot_profiles WHERE game_type = 'teen_patti' AND difficulty = $1`,
			botDifficulty).Scan(&target)
		if err == nil {
			winRateTarget = target
		} else {
			switch botDifficulty {
			case "easy":
				winRateTarget = 35.0
			case "medium":
				winRateTarget = 50.0
			case "hard":
				winRateTarget = 100.0 // default hard target is 100% for user testing
			}
		}
	} else {
		switch botDifficulty {
		case "easy":
			winRateTarget = 35.0
		case "medium":
			winRateTarget = 50.0
		case "hard":
			winRateTarget = 100.0
		}
	}

	// DDAS (Dynamic Difficulty and Adaptive Swapping) card distribution bias logic
	botIndices := []int{}
	hasHuman := false
	for i := range players {
		if players[i].IsBot {
			botIndices = append(botIndices, i)
		} else {
			hasHuman = true
		}
	}

	if len(botIndices) > 0 && hasHuman {
		bestIdx := findBestHandIndex(players, variation, jokerRank)
		if bestIdx != -1 && !players[bestIdx].IsBot {
			// Best hand is currently held by a human. Roll to see if we swap it to a bot.
			nBig, err := cryptoRand.Int(cryptoRand.Reader, big.NewInt(10000))
			var roll float64
			if err == nil {
				roll = float64(nBig.Int64()) / 100.0
			} else {
				roll = 50.0
			}

			if roll < winRateTarget {
				// Swap cards with the first bot
				targetBotIdx := botIndices[0]
				players[bestIdx].Cards, players[targetBotIdx].Cards = players[targetBotIdx].Cards, players[bestIdx].Cards
				log.Printf("[DDAS] Swapped best hand from human player %s (seat %d) to bot %s (seat %d) based on target win rate %.2f%% (roll: %.2f)",
					players[bestIdx].Username, players[bestIdx].Seat,
					players[targetBotIdx].Username, players[targetBotIdx].Seat,
					winRateTarget, roll)
			}
		}
	}

	state := GameState{
		RoomID:        req.RoomID,
		GameType:      "teen_patti",
		Stake:         req.Stake,
		Players:       players,
		Status:        "betting",
		CurrentTurn:   0,
		Pot:           req.Stake * float64(len(players)),
		PotLimit:      startPotLimit(req),
		NoLimit:       req.NoLimit,
		Round:         1,
		MinBet:        req.Stake,
		DealerID:      players[0].UserID,
		CreatedAt:     time.Now().Unix(),
		BotDifficulty: botDifficulty,
		Variation:     variation,
		JokerRank:     jokerRank,
		JokerValue:    jokerValue,
	}

	stateJSON, _ := json.Marshal(state)
	ctx := context.Background()
	s.redis.Set(ctx, fmt.Sprintf("tp:game:%s", req.RoomID), stateJSON, 2*time.Hour)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

func (s *Server) processAction(w http.ResponseWriter, r *http.Request) {
	var req ActionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}

	ctx := context.Background()
	err := s.withRoomLock(ctx, req.RoomID, func() error {
		rawState, err := s.redis.Get(ctx, fmt.Sprintf("tp:game:%s", req.RoomID)).Bytes()
		if err != nil {
			http.Error(w, "game not found", 404)
			return nil
		}

		var state GameState
		json.Unmarshal(rawState, &state)

		playerIdx := -1
		for i, p := range state.Players {
			if p.UserID == req.UserID {
				playerIdx = i
				break
			}
		}
		if playerIdx == -1 {
			http.Error(w, "player not in game", 400)
			return nil
		}

		response := map[string]interface{}{"status": "ok", "action": req.Action}

		// While a sideshow awaits a response, the game is frozen: only the target
		// may accept/reject, and only the requester may fold (e.g. turn-timer
		// auto-fold). Everything else must wait for resolution.
		if state.PendingSideshow != nil {
			ps := state.PendingSideshow
			isTargetResponse := (req.Action == "sideshow_accept" || req.Action == "sideshow_reject") && req.UserID == ps.TargetID
			isRequesterFold := req.Action == "fold" && req.UserID == ps.RequesterID
			if !isTargetResponse && !isRequesterFold {
				http.Error(w, "waiting for sideshow response", 400)
				return nil
			}
		}

		switch req.Action {
		case "fold":
			state.Players[playerIdx].Status = "folded"
			// A fold by either party of a pending sideshow cancels it.
			if state.PendingSideshow != nil &&
				(req.UserID == state.PendingSideshow.RequesterID || req.UserID == state.PendingSideshow.TargetID) {
				state.PendingSideshow = nil
			}
		case "call":
			callAmount := state.MinBet
			if state.Players[playerIdx].IsSeen {
				callAmount = state.MinBet * 2
			}
			state.Players[playerIdx].Bet += callAmount
			state.Pot += callAmount
		case "raise":
			raiseAmount := req.Amount
			isSeen := state.Players[playerIdx].IsSeen
			if isSeen {
				if raiseAmount < state.MinBet*2 {
					http.Error(w, "raise amount too small for seen player", 400)
					return nil
				}
				state.Players[playerIdx].Bet += raiseAmount
				state.Pot += raiseAmount
				state.MinBet = raiseAmount / 2.0
			} else {
				if raiseAmount < state.MinBet {
					http.Error(w, "raise amount too small for blind player", 400)
					return nil
				}
				state.Players[playerIdx].Bet += raiseAmount
				state.Pot += raiseAmount
				state.MinBet = raiseAmount
			}
		case "show":
			activeCount := 0
			for _, p := range state.Players {
				if p.Status != "folded" {
					activeCount++
				}
			}
			if activeCount != 2 {
				http.Error(w, "Show is only allowed when exactly 2 active players remain", 400)
				return nil
			}
			showCost := state.MinBet
			if state.Players[playerIdx].IsSeen {
				showCost = state.MinBet * 2
			}
			state.Players[playerIdx].Bet += showCost
			state.Pot += showCost
			state.Players[playerIdx].IsSeen = true
		case "see":
			state.Players[playerIdx].IsSeen = true
		case "sideshow":
			// A seen player, on their turn, asks the previous active player to
			// privately compare cards. Costs a seen chaal (2x current stake).
			// Only meaningful with 3+ active players — with 2 you use "show".
			if state.CurrentTurn != playerIdx {
				http.Error(w, "not your turn", 400)
				return nil
			}
			if !state.Players[playerIdx].IsSeen {
				http.Error(w, "you must see your cards before asking for a sideshow", 400)
				return nil
			}
			if state.Players[playerIdx].Status != "active" {
				http.Error(w, "player not active", 400)
				return nil
			}
			activeCount := 0
			for _, p := range state.Players {
				if p.Status == "active" {
					activeCount++
				}
			}
			if activeCount < 3 {
				http.Error(w, "sideshow needs at least 3 active players", 400)
				return nil
			}
			// Previous active player is the target
			prev := (playerIdx - 1 + len(state.Players)) % len(state.Players)
			for state.Players[prev].Status != "active" {
				prev = (prev - 1 + len(state.Players)) % len(state.Players)
			}
			cost := state.MinBet * 2
			state.Players[playerIdx].Bet += cost
			state.Pot += cost
			state.PendingSideshow = &SideshowState{
				RequesterID: req.UserID,
				TargetID:    state.Players[prev].UserID,
				RequestedAt: time.Now().Unix(),
			}
			response["sideshow_request"] = map[string]interface{}{
				"requester_id":       req.UserID,
				"requester_username": state.Players[playerIdx].Username,
				"target_id":          state.Players[prev].UserID,
				"target_username":    state.Players[prev].Username,
			}
		case "sideshow_accept":
			ps := state.PendingSideshow
			if ps == nil || req.UserID != ps.TargetID {
				http.Error(w, "no sideshow to accept", 400)
				return nil
			}
			reqIdx, tgtIdx := -1, -1
			for i, p := range state.Players {
				if p.UserID == ps.RequesterID {
					reqIdx = i
				}
				if p.UserID == ps.TargetID {
					tgtIdx = i
				}
			}
			if reqIdx == -1 || tgtIdx == -1 {
				state.PendingSideshow = nil
				http.Error(w, "sideshow players missing", 400)
				return nil
			}
			// Both players now see each other's cards privately; the requester's
			// turn resumes and they decide chaal or pack with that knowledge.
			state.Players[reqIdx].IsSeen = true
			state.Players[tgtIdx].IsSeen = true
			state.PendingSideshow = nil
			response["sideshow_reveal"] = map[string]interface{}{
				"requester_id":       ps.RequesterID,
				"requester_username": state.Players[reqIdx].Username,
				"target_id":          ps.TargetID,
				"target_username":    state.Players[tgtIdx].Username,
				"requester_cards":    state.Players[reqIdx].Cards,
				"target_cards":       state.Players[tgtIdx].Cards,
			}
		case "sideshow_reject":
			ps := state.PendingSideshow
			if ps == nil || req.UserID != ps.TargetID {
				http.Error(w, "no sideshow to reject", 400)
				return nil
			}
			state.PendingSideshow = nil
			response["sideshow_rejected"] = map[string]interface{}{
				"requester_id": ps.RequesterID,
				"target_id":    ps.TargetID,
			}
		default:
			// Unknown actions used to fall through and silently burn the turn.
			http.Error(w, "unknown action: "+req.Action, 400)
			return nil
		}

		// Advance turn
		activePlayers := 0
		for _, p := range state.Players {
			if p.Status == "active" {
				activePlayers++
			}
		}

		var gameResult *GameResult

		// Actions that leave the turn where it is: seeing your own cards, and the
		// whole sideshow exchange (the requester's turn is frozen during it and
		// resumes with chaal/pack after accept/reject).
		holdsTurn := map[string]bool{
			"see": true, "sideshow": true, "sideshow_accept": true, "sideshow_reject": true,
		}

		// Pot limit: once the pot reaches the cap for this boot amount, betting
		// stops and the hand goes straight to showdown among unfolded players.
		// No-limit tables are exempt. Games dealt before these fields existed
		// have PotLimit 0 without NoLimit — derive their cap from the stake.
		potLimit := state.PotLimit
		if potLimit <= 0 && !state.NoLimit {
			potLimit = potLimitFor(state.Stake)
		}
		potLimitHit := potLimit > 0 && state.Pot >= potLimit

		if activePlayers <= 1 || req.Action == "show" || potLimitHit {
			if potLimitHit && activePlayers > 1 && req.Action != "show" {
				state.PendingSideshow = nil
				response["pot_limit_reached"] = true
			}
			// Determine winner
			gameResult = s.determineWinner(&state)
			state.Status = "completed"
			log.Printf("[teen-patti] Game completed: room=%s winner=%s prize=%.2f action=%s", req.RoomID, gameResult.WinnerID, gameResult.Prize, req.Action)

			// Save completed game to DB
			go s.saveCompletedGame(req.RoomID, gameResult)
		} else if !holdsTurn[req.Action] {
			// Next active player
			next := (state.CurrentTurn + 1) % len(state.Players)
			for state.Players[next].Status != "active" {
				next = (next + 1) % len(state.Players)
			}
			state.CurrentTurn = next
		}

		stateJSON, _ := json.Marshal(state)
		s.redis.Set(ctx, fmt.Sprintf("tp:game:%s", req.RoomID), stateJSON, 2*time.Hour)

		response["state"] = state
		if gameResult != nil {
			response["result"] = gameResult
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return nil
	})
	if err == errRoomBusy {
		http.Error(w, err.Error(), 409)
	}
}

// startPotLimit resolves the pot cap for a new game: 0 (uncapped) for
// no-limit tables, otherwise the tier for the boot amount.
func startPotLimit(req StartGameReq) float64 {
	if req.NoLimit {
		return 0
	}
	return potLimitFor(req.Stake)
}

// potLimitFor returns the maximum pot for a boot (stake) amount. When the pot
// reaches this cap, betting stops and the hand goes to a forced showdown.
// Tiers: ₹10→₹500, ₹50→₹1000, ₹100→₹1500, ₹500→₹10000, ₹1000+→₹20000.
func potLimitFor(stake float64) float64 {
	switch {
	case stake <= 10:
		return 500
	case stake <= 50:
		return 1000
	case stake <= 100:
		return 1500
	case stake <= 500:
		return 10000
	default:
		return 20000
	}
}

// loadRakePct reads the admin-configured platform fee for Teen Patti from
// game_configs.rake_percent (a percentage, e.g. 5 = 5%) and returns it as a
// fraction. Falls back to 5% if the config is missing or out of range.
func (s *Server) loadRakePct() float64 {
	const def = 0.05
	if s.db == nil {
		return def
	}
	var pct float64
	err := s.db.QueryRow(context.Background(),
		`SELECT rake_percent FROM game_configs WHERE game_type = 'teen_patti'`).Scan(&pct)
	if err != nil || pct < 0 || pct > 50 {
		return def
	}
	return pct / 100.0
}

func (s *Server) determineWinner(state *GameState) *GameResult {
	rakePct := s.loadRakePct()
	rake := state.Pot * rakePct
	prize := state.Pot - rake

	var bestPlayer *Player
	var bestHand HandResult

	allHands := []map[string]interface{}{}

	for i := range state.Players {
		p := &state.Players[i]
		if p.Status == "folded" {
			continue
		}
		hand := evaluateHandVariant(state.Variation, state.JokerRank, p.Cards)
		allHands = append(allHands, map[string]interface{}{
			"user_id":   p.UserID,
			"hand_rank": handRankName(hand.Rank),
			"cards":     p.Cards,
		})
		if bestPlayer == nil || compareHandsVariant(state.Variation, hand, bestHand) > 0 {
			bestPlayer = p
			bestHand = hand
		} else if compareHandsVariant(state.Variation, hand, bestHand) == 0 {
			// Tiebreaker:
			// 1. Blind player wins over Seen player
			// 2. If both blind or both seen, the player who did NOT request the show wins (defender wins)
			// Note: state.Players[state.CurrentTurn] is the one who requested the show.
			requesterID := state.Players[state.CurrentTurn].UserID
			if !p.IsSeen && bestPlayer.IsSeen {
				bestPlayer = p
				bestHand = hand
			} else if p.IsSeen == bestPlayer.IsSeen {
				if p.UserID != requesterID && bestPlayer.UserID == requesterID {
					bestPlayer = p
					bestHand = hand
				}
			}
		}
	}

	winnerID := ""
	if bestPlayer != nil {
		winnerID = bestPlayer.UserID
	}

	handRankName := handRankName(bestHand.Rank)
	if handRankName == "" {
		handRankName = "High Card"
	}
	return &GameResult{
		WinnerID: winnerID,
		Prize:    prize,
		RakeFee:  rake,
		HandRank: handRankName,
		AllHands: allHands,
	}
}

func (s *Server) saveCompletedGame(roomID string, result *GameResult) {
	ctx := context.Background()
	_, err := s.db.Exec(ctx,
		`UPDATE game_rooms SET status = 'completed', ended_at = NOW(), platform_fee_collected = $1 WHERE id = $2`,
		result.RakeFee, roomID,
	)
	if err != nil {
		log.Printf("Error saving completed game: %v", err)
	}

	if result.WinnerID != "" {
		_, err = s.db.Exec(ctx,
			`UPDATE game_participants SET prize_won = $1, final_rank = 1 WHERE room_id = $2 AND user_id = $3`,
			result.Prize, roomID, result.WinnerID,
		)
		if err != nil {
			log.Printf("Error updating winner: %v", err)
		}
	}
}

func (s *Server) getState(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room_id")
	ctx := context.Background()
	rawState, err := s.redis.Get(ctx, fmt.Sprintf("tp:game:%s", roomID)).Bytes()
	if err != nil {
		http.Error(w, "game not found", 404)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(rawState)
}

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgresql://teen:teen_secret_2024@localhost:5432/teen_db"
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://:teen_redis_2024@localhost:6379"
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}

	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("Redis URL parse failed: %v", err)
	}
	rdb := redis.NewClient(opt)

	srv := &Server{db: pool, redis: rdb}

	mux := http.NewServeMux()
	mux.HandleFunc("/start", srv.startGame)
	mux.HandleFunc("/action", srv.processAction)
	mux.HandleFunc("/state", srv.getState)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"status":"ok","service":"teen-patti-engine"}`))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "3010"
	}
	log.Printf("Teen Patti engine running on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
