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
