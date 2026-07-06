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
		bestIdx := findBestHandIndex(players)
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

