package main

import "testing"

// The bands must stay cumulative and in fold/call/raise order — this is the
// exact distribution the gateway's pickBotAction used, and the split must not
// shift live bot aggression.
func TestPickBotActionBands(t *testing.T) {
	// medium tier: fold 0.30, call 0.47, raise 0.23
	cases := []struct {
		roll float64
		want string
	}{
		{0.00, "fold"},
		{0.29, "fold"},
		{0.30, "call"},
		{0.76, "call"},
		{0.77, "raise"},
		{0.99, "raise"},
	}
	for _, c := range cases {
		if got := pickBotAction(0.30, 0.47, c.roll); got != c.want {
			t.Errorf("roll %.2f: got %s, want %s", c.roll, got, c.want)
		}
	}
}

// A profile whose rates sum to less than 1 must leave the remainder on raise,
// not normalise. Normalising would silently change how often existing bots
// raise the moment this shipped.
func TestPickBotActionUnderSumFallsToRaise(t *testing.T) {
	if got := pickBotAction(0.2, 0.2, 0.5); got != "raise" {
		t.Errorf("got %s, want raise", got)
	}
}

// The gateway could not see PotLimit, so it sometimes asked for a raise above
// the table maximum and the engine rejected the turn with a 400.
func TestBotRaiseAmountClampsToTableMax(t *testing.T) {
	state := &GameState{Stake: 10, MinBet: 10, Pot: 40, PotLimit: 25, NoLimit: false}
	got := botRaiseAmount(state)
	max := maxRaiseFor(state.Stake, state.Pot, state.PotLimit, state.NoLimit)
	if got > max {
		t.Errorf("raise %.2f exceeds table max %.2f", got, max)
	}
}

// A seen player must raise at least 2x MinBet. Below that the engine rejects
// the action, so the bot downgrades to a call rather than forfeiting its turn.
func TestLegalBotActionDowngradesUndersizedSeenRaise(t *testing.T) {
	state := &GameState{MinBet: 10}
	seen := &Player{IsSeen: true}
	action, amount := legalBotAction(state, seen, "raise", 15)
	if action != "call" {
		t.Errorf("got %s, want call", action)
	}
	if amount != state.MinBet {
		t.Errorf("got amount %.2f, want %.2f", amount, state.MinBet)
	}

	// 20 clears the seen minimum and must survive untouched.
	if action, amount := legalBotAction(state, seen, "raise", 20); action != "raise" || amount != 20 {
		t.Errorf("got %s/%.2f, want raise/20", action, amount)
	}
}

func TestLegalBotActionLeavesFoldAndCallAlone(t *testing.T) {
	state := &GameState{MinBet: 10}
	p := &Player{}
	for _, want := range []string{"fold", "call"} {
		if got, _ := legalBotAction(state, p, want, 0); got != want {
			t.Errorf("got %s, want %s", got, want)
		}
	}
}
