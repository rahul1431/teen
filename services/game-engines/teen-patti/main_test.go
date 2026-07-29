package main

import (
	"testing"
)

func TestEvaluateHand(t *testing.T) {
	// Test kicker tiebreaker bug
	// Pair of Aces with King kicker
	hand1 := []Card{
		{Value: "A", Suit: Spades, Rank: 14},
		{Value: "A", Suit: Hearts, Rank: 14},
		{Value: "K", Suit: Clubs, Rank: 13},
	}
	// Pair of Aces with Queen kicker
	hand2 := []Card{
		{Value: "A", Suit: Diamonds, Rank: 14},
		{Value: "A", Suit: Clubs, Rank: 14},
		{Value: "Q", Suit: Spades, Rank: 12},
	}

	res1 := evaluateHand(hand1)
	res2 := evaluateHand(hand2)

	if res1.Rank != Pair || res2.Rank != Pair {
		t.Fatalf("Expected Rank to be Pair (2), got res1=%d, res2=%d", res1.Rank, res2.Rank)
	}

	if res1.Score <= res2.Score {
		t.Errorf("Expected hand1 (Score %d) to beat hand2 (Score %d), kicker tiebreaker failed", res1.Score, res2.Score)
	}
}

func TestDetermineWinnerTiebreaker(t *testing.T) {
	// 1. Blind player wins over Seen player on tie
	state := &GameState{
		Players: []Player{
			{
				UserID: "p1",
				Status: "active",
				IsSeen: true, // Seen
				Cards: []Card{
					{Value: "A", Suit: Spades, Rank: 14},
					{Value: "A", Suit: Hearts, Rank: 14},
					{Value: "K", Suit: Clubs, Rank: 13},
				},
			},
			{
				UserID: "p2",
				Status: "active",
				IsSeen: false, // Blind
				Cards: []Card{
					{Value: "A", Suit: Diamonds, Rank: 14},
					{Value: "A", Suit: Clubs, Rank: 14},
					{Value: "K", Suit: Spades, Rank: 13},
				},
			},
		},
		CurrentTurn: 0, // p1 requested show/action
		Pot:         100,
	}

	srv := &Server{}
	res := srv.determineWinner(state)

	if res.WinnerID != "p2" {
		t.Errorf("Expected blind player p2 to win, got winner %s", res.WinnerID)
	}
}

func TestDDASCardSwapping(t *testing.T) {
	// Set up a game with 1 human and 1 bot.
	// Human gets a very strong hand: three Aces (Trail of Aces).
	// Bot gets a weak hand: High Card 9.
	players := []Player{
		{
			UserID:   "human_1",
			Username: "Human",
			IsBot:    false,
			Status:   "active",
			Cards: []Card{
				{Value: "A", Suit: Spades, Rank: 14},
				{Value: "A", Suit: Hearts, Rank: 14},
				{Value: "A", Suit: Clubs, Rank: 14},
			},
		},
		{
			UserID:   "bot_1",
			Username: "Bot",
			IsBot:    true,
			Status:   "active",
			Cards: []Card{
				{Value: "2", Suit: Spades, Rank: 2},
				{Value: "5", Suit: Hearts, Rank: 5},
				{Value: "9", Suit: Clubs, Rank: 9},
			},
		},
	}


	// DDAS Logic simulation
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
		bestIdx := findBestHandIndex(players, "classic", 0)
		if bestIdx != -1 && !players[bestIdx].IsBot {
			// Best hand is held by human. Swap cards with the first bot.
			targetBotIdx := botIndices[0]
			players[bestIdx].Cards, players[targetBotIdx].Cards = players[targetBotIdx].Cards, players[bestIdx].Cards
		}
	}

	// Now check if Bot has the superior hand (the Trail of Aces)
	botHand := evaluateHand(players[1].Cards)
	humanHand := evaluateHand(players[0].Cards)

	if botHand.Rank != Trail {
		t.Errorf("Expected bot to have Trail after swap, got Rank %d", botHand.Rank)
	}
	if humanHand.Rank != HighCard {
		t.Errorf("Expected human to have HighCard after swap, got Rank %d", humanHand.Rank)
	}

	// Verify that the cards are swapped and unique (no duplicate cards)
	cardMap := make(map[string]bool)
	for _, p := range players {
		for _, c := range p.Cards {
			cardKey := c.Value + c.Suit
			if cardMap[cardKey] {
				t.Errorf("Duplicate card found: %s", cardKey)
			}
			cardMap[cardKey] = true
		}
	}
}

func TestMuflisInvertsRanking(t *testing.T) {
	trail := []Card{
		{Value: "A", Suit: Spades, Rank: 14},
		{Value: "A", Suit: Hearts, Rank: 14},
		{Value: "A", Suit: Clubs, Rank: 14},
	}
	low := []Card{
		{Value: "2", Suit: Spades, Rank: 2},
		{Value: "3", Suit: Hearts, Rank: 3},
		{Value: "5", Suit: Clubs, Rank: 5},
	}
	trailHand := evaluateHandVariant("muflis", 0, trail)
	lowHand := evaluateHandVariant("muflis", 0, low)
	if compareHandsVariant("muflis", lowHand, trailHand) <= 0 {
		t.Errorf("muflis: expected 2-3-5 to beat trail of Aces")
	}
	// determineWinner end-to-end: the low hand must win the pot
	state := &GameState{
		Variation: "muflis",
		Players: []Player{
			{UserID: "p1", Status: "active", Cards: trail},
			{UserID: "p2", Status: "active", Cards: low},
		},
		CurrentTurn: 0,
		Pot:         100,
	}
	srv := &Server{}
	if res := srv.determineWinner(state); res.WinnerID != "p2" {
		t.Errorf("muflis: expected p2 (worst classic hand) to win, got %s", res.WinnerID)
	}
}

func TestJokerWildSubstitution(t *testing.T) {
	// Jokers this hand: 9s. A pair of Kings + a 9 must evaluate as Trail of Kings.
	cards := []Card{
		{Value: "K", Suit: Spades, Rank: 13},
		{Value: "K", Suit: Hearts, Rank: 13},
		{Value: "9", Suit: Clubs, Rank: 9},
	}
	hand := evaluateHandVariant("joker", 9, cards)
	if hand.Rank != Trail {
		t.Errorf("joker: expected K-K-9 (9s wild) to be Trail, got rank %d", hand.Rank)
	}
	// Without the wild it stays a pair
	plain := evaluateHandVariant("joker", 5, cards)
	if plain.Rank != Pair {
		t.Errorf("joker: expected K-K-9 (5s wild) to be Pair, got rank %d", plain.Rank)
	}
}

func TestAK47WildSubstitution(t *testing.T) {
	// A, K, 4, 7 are wild in AK47: Q-Q-4 must evaluate as Trail of Queens.
	cards := []Card{
		{Value: "Q", Suit: Spades, Rank: 12},
		{Value: "Q", Suit: Hearts, Rank: 12},
		{Value: "4", Suit: Clubs, Rank: 4},
	}
	if hand := evaluateHandVariant("ak47", 0, cards); hand.Rank != Trail {
		t.Errorf("ak47: expected Q-Q-4 to be Trail, got rank %d", hand.Rank)
	}
	// Classic evaluation of the same cards stays a pair
	if hand := evaluateHandVariant("classic", 0, cards); hand.Rank != Pair {
		t.Errorf("classic: expected Q-Q-4 to be Pair, got rank %d", hand.Rank)
	}
}

func TestPotLimitFor(t *testing.T) {
	cases := []struct{ stake, want float64 }{
		{10, 500},
		{50, 1000},
		{100, 1500},
		{500, 10000},
		{1000, 20000},
		{25, 1000},    // between tiers → next tier up
		{2000, 20000}, // above top tier → top cap
	}
	for _, c := range cases {
		if got := potLimitFor(c.stake); got != c.want {
			t.Errorf("potLimitFor(%v) = %v, want %v", c.stake, got, c.want)
		}
	}
}

func TestStartPotLimit(t *testing.T) {
	if got := startPotLimit(StartGameReq{Stake: 100}); got != 1500 {
		t.Errorf("classic table: startPotLimit = %v, want 1500", got)
	}
	if got := startPotLimit(StartGameReq{Stake: 100, NoLimit: true}); got != 0 {
		t.Errorf("no-limit table: startPotLimit = %v, want 0 (uncapped)", got)
	}
}

func TestMaxRaiseFor(t *testing.T) {
	// Stake 1000 * maxChaalMultiplier(4) = 4000, well under the bots' flat
	// 10000 balance — this is the exploit's actual fix: a raise this size
	// can no longer force every bot at the table to fold.
	if got := maxRaiseFor(1000, 0, 20000, false); got != 4000 {
		t.Errorf("maxRaiseFor(stake=1000, pot=0, potLimit=20000) = %v, want 4000 (chaal-multiplier capped)", got)
	}
	// Pot already close to its cap: remaining headroom (3000) is smaller than
	// the chaal-multiplier cap (1000*4=4000), so headroom wins.
	if got := maxRaiseFor(1000, 17000, 20000, false); got != 3000 {
		t.Errorf("maxRaiseFor(stake=1000, pot=17000, potLimit=20000) = %v, want 3000 (pot-headroom capped)", got)
	}
	// No-limit table: no pot cap, so only the chaal-multiplier bound applies.
	if got := maxRaiseFor(1000, 50000, 0, true); got != 4000 {
		t.Errorf("maxRaiseFor(stake=1000, pot=50000, noLimit) = %v, want 4000 (chaal-multiplier only)", got)
	}
	// Pot has already reached/exceeded its cap: no headroom left for a raise.
	if got := maxRaiseFor(10, 500, 500, false); got != 0 {
		t.Errorf("maxRaiseFor(stake=10, pot=500, potLimit=500) = %v, want 0 (no headroom)", got)
	}
}

