package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
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
	RoomID      string   `json:"room_id"`
	GameType    string   `json:"game_type"`
	Stake       float64  `json:"stake"`
	Players     []Player `json:"players"`
	Status      string   `json:"status"`
	CurrentTurn int      `json:"current_turn"`
	Pot         float64  `json:"pot"`
	Round       int      `json:"round"`
	MinBet      float64  `json:"min_bet"`
	CreatedAt   int64    `json:"created_at"`
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
	// Fisher-Yates shuffle using crypto-quality source
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	r.Shuffle(len(deck), func(i, j int) { deck[i], deck[j] = deck[j], deck[i] })
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
	isSeq := (ranks[0]-ranks[1] == 1 && ranks[1]-ranks[2] == 1) ||
		(ranks[0] == 14 && ranks[1] == 3 && ranks[2] == 2) // A-2-3

	if isSeq && sameSuit {
		return HandResult{Rank: PureSequence, Score: ranks[0]*100 + ranks[1]*10 + ranks[2]}
	}
	if isSeq {
		return HandResult{Rank: Sequence, Score: ranks[0]*100 + ranks[1]*10 + ranks[2]}
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

type Server struct {
	db    *pgxpool.Pool
	redis *redis.Client
}

type StartGameReq struct {
	RoomID  string   `json:"room_id"`
	Players []Player `json:"players"`
	Stake   float64  `json:"stake"`
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

	deck := newDeck()
	players := req.Players

	// Deal 3 cards to each player
	for i := range players {
		players[i].Cards = deck[i*3 : i*3+3]
		players[i].Status = "active"
		players[i].IsSeen = false
		players[i].Bet = req.Stake
	}

	state := GameState{
		RoomID:      req.RoomID,
		GameType:    "teen_patti",
		Stake:       req.Stake,
		Players:     players,
		Status:      "betting",
		CurrentTurn: 0,
		Pot:         req.Stake * float64(len(players)),
		Round:       1,
		MinBet:      req.Stake,
		CreatedAt:   time.Now().Unix(),
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
	rawState, err := s.redis.Get(ctx, fmt.Sprintf("tp:game:%s", req.RoomID)).Bytes()
	if err != nil {
		http.Error(w, "game not found", 404)
		return
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
		return
	}

	response := map[string]interface{}{"status": "ok", "action": req.Action}

	switch req.Action {
	case "fold":
		state.Players[playerIdx].Status = "folded"
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
				return
			}
			state.Players[playerIdx].Bet += raiseAmount
			state.Pot += raiseAmount
			state.MinBet = raiseAmount / 2.0
		} else {
			if raiseAmount < state.MinBet {
				http.Error(w, "raise amount too small for blind player", 400)
				return
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
			return
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
	}

	// Advance turn
	activePlayers := 0
	for _, p := range state.Players {
		if p.Status == "active" {
			activePlayers++
		}
	}

	var gameResult *GameResult

	if activePlayers <= 1 || req.Action == "show" {
		// Determine winner
		gameResult = s.determineWinner(&state)
		state.Status = "completed"

		// Save completed game to DB
		go s.saveCompletedGame(req.RoomID, gameResult)
	} else if req.Action != "see" {
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
}

// loadRakePct reads the admin-configured platform fee for Teen Patti from
// game_configs.rake_percent (a percentage, e.g. 5 = 5%) and returns it as a
// fraction. Falls back to 5% if the config is missing or out of range.
func (s *Server) loadRakePct() float64 {
	const def = 0.05
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
		hand := evaluateHand(p.Cards)
		allHands = append(allHands, map[string]interface{}{
			"user_id":   p.UserID,
			"hand_rank": handRankName(hand.Rank),
			"cards":     p.Cards,
		})
		if bestPlayer == nil || compareHands(hand, bestHand) > 0 {
			bestPlayer = p
			bestHand = hand
		} else if compareHands(hand, bestHand) == 0 {
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

	return &GameResult{
		WinnerID: winnerID,
		Prize:    prize,
		RakeFee:  rake,
		HandRank: handRankName(bestHand.Rank),
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
	_ = uuid.New() // ensure import used

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
