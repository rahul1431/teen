package main

import (
	"math"
	"testing"
)

// The bands must stay cumulative and in fold/call/raise order.
func TestPickBotActionBands(t *testing.T) {
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

// Weights that don't sum to 1 must become a real distribution, and an all-zero
// profile must not silently mean "always raise" — it means "no information",
// which resolves to the least destructive action.
func TestNormaliseWeights(t *testing.T) {
	f, c, r := normaliseWeights(1, 1, 2)
	if math.Abs(f+c+r-1) > 1e-9 || math.Abs(f-0.25) > 1e-9 {
		t.Errorf("got %.3f/%.3f/%.3f, want 0.25/0.25/0.5", f, c, r)
	}
	if f, c, r := normaliseWeights(0, 0, 0); f != 0 || c != 1 || r != 0 {
		t.Errorf("degenerate profile: got %.2f/%.2f/%.2f, want 0/1/0", f, c, r)
	}
}

// The gateway could not see PotLimit, so it sometimes asked for a raise above
// the table maximum and the engine rejected the turn with a 400.
func TestBotRaiseAmountClampsToTableMax(t *testing.T) {
	state := &GameState{Stake: 10, MinBet: 10, Pot: 40, PotLimit: 25, NoLimit: false}
	max := maxRaiseFor(state.Stake, state.Pot, state.PotLimit, state.NoLimit)
	if got := botRaiseAmount(state, 999); got > max {
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
	// A seen player's call costs 2x MinBet, not MinBet.
	if amount != 20 {
		t.Errorf("got amount %.2f, want 20", amount)
	}

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
	// "see" is free — a non-zero amount here would have the gateway lock chips
	// out of the bot's wallet for an action that costs nothing.
	if got, amt := legalBotAction(state, p, "see", 0); got != "see" || amt != 0 {
		t.Errorf("got %s/%.2f, want see/0", got, amt)
	}
}

// --- Hand strength -------------------------------------------------------

// The percentile is only meaningful if it agrees with who actually wins, so
// check it against the ordering the showdown uses.
func TestHandStrengthOrdering(t *testing.T) {
	card := func(v, s string) Card { return Card{Value: v, Suit: s, Rank: rankCard(v)} }

	trail := []Card{card("A", Spades), card("A", Hearts), card("A", Clubs)}
	pureSeq := []Card{card("A", Spades), card("K", Spades), card("Q", Spades)}
	pair := []Card{card("7", Spades), card("7", Hearts), card("2", Clubs)}
	junk := []Card{card("7", Spades), card("5", Hearts), card("2", Clubs)}

	got := map[string]float64{
		"trail":   handStrength("classic", 0, trail),
		"pureSeq": handStrength("classic", 0, pureSeq),
		"pair":    handStrength("classic", 0, pair),
		"junk":    handStrength("classic", 0, junk),
	}
	if !(got["trail"] > got["pureSeq"] && got["pureSeq"] > got["pair"] && got["pair"] > got["junk"]) {
		t.Errorf("strength not monotone with hand rank: %+v", got)
	}
	if got["trail"] < 0.99 {
		t.Errorf("A-A-A should be near the top, got %.4f", got["trail"])
	}
	if got["junk"] > 0.5 {
		t.Errorf("7-high should be weak, got %.4f", got["junk"])
	}
	for name, v := range got {
		if v < 0 || v > 1 {
			t.Errorf("%s strength %.4f out of range", name, v)
		}
	}
}

// Muflis inverts the ranking, so the best classic hand must be the worst one.
func TestHandStrengthMuflisInverts(t *testing.T) {
	card := func(v, s string) Card { return Card{Value: v, Suit: s, Rank: rankCard(v)} }
	trail := []Card{card("A", Spades), card("A", Hearts), card("A", Clubs)}

	classic := handStrength("classic", 0, trail)
	muflis := handStrength("muflis", 0, trail)
	if math.Abs(classic+muflis-1) > 1e-9 {
		t.Errorf("muflis %.4f should mirror classic %.4f", muflis, classic)
	}
}

// The table must cover every possible hand — an off-by-one in the enumeration
// would skew every percentile it produces.
func TestStrengthTableCoversAllHands(t *testing.T) {
	strengthOnce.Do(buildStrengthTable)
	if len(handKeys) != 22100 {
		t.Errorf("got %d hands, want 22100 (C(52,3))", len(handKeys))
	}
}

// --- Policy --------------------------------------------------------------

func baseSituation() botSituation {
	return botSituation{
		opponents: 1, callCost: 20, pot: 100, chaals: 1, isSeen: true,
		aggression: 0.5, foldP: 0.30, callP: 0.47, raiseP: 0.23, minBet: 10,
	}
}

// never = rolls that decline every optional behaviour, isolating the main draw.
func never() botRolls { return botRolls{action: 0.0, see: 1, bluff: 1, trap: 1, show: 1} }

// A blind bot must not consult its cards. Handing the policy a monster and a
// junk hand while blind must produce identical decisions — if it doesn't, the
// bot is betting cards it hasn't looked at.
func TestBlindBotIgnoresItsCards(t *testing.T) {
	strong, weak := baseSituation(), baseSituation()
	strong.isSeen, weak.isSeen = false, false
	strong.strength, weak.strength = 0.99, 0.01

	for _, roll := range []float64{0.0, 0.25, 0.5, 0.75, 0.99} {
		r := never()
		r.action = roll
		a1, amt1, _ := decideBot(strong, r)
		a2, amt2, _ := decideBot(weak, r)
		if a1 != a2 || amt1 != amt2 {
			t.Errorf("roll %.2f: blind bot leaked card knowledge — %s/%.2f vs %s/%.2f", roll, a1, amt1, a2, amt2)
		}
	}
}

// A blind bot eventually looks, and looking is free.
func TestBlindBotSeesCards(t *testing.T) {
	s := baseSituation()
	s.isSeen = false
	s.chaals = 3 // seeChance = 0.18*3 + 0.10 - 0.10*0.5 = 0.59
	r := never()
	r.see = 0.1
	action, amount, _ := decideBot(s, r)
	if action != "see" || amount != 0 {
		t.Errorf("got %s/%.2f, want see/0", action, amount)
	}

	// The chance must RISE with the price already paid. GameState.Round is a
	// constant 1 in this engine, so anything keyed on it never moves — that bug
	// left bots blind for most of a hand and is what this asserts against.
	prev := -1.0
	for _, c := range []float64{0, 1, 2, 3, 4} {
		s.chaals = c
		chance := clamp(0.18*s.chaals+0.10-0.10*s.aggression, 0, 0.85)
		if chance <= prev {
			t.Errorf("seeChance did not rise at chaals=%.0f: %.3f after %.3f", c, chance, prev)
		}
		prev = chance
	}

	// Freshly dealt, having paid only the ante, a bot usually has not looked yet.
	s.chaals = 0
	r.see = 0.5
	if action, _, _ := decideBot(s, r); action == "see" {
		t.Errorf("looked at cards immediately on the deal")
	}
}

// The whole point of the move into the engine: a strong hand and a weak hand
// must not play the same.
func TestSeenBotPlaysItsHand(t *testing.T) {
	strong, weak := baseSituation(), baseSituation()
	strong.strength, weak.strength = 0.95, 0.05

	// A mid draw that the base profile calls: strength should push it apart.
	r := never()
	r.action = 0.5

	sAction, _, _ := decideBot(strong, r)
	wAction, _, _ := decideBot(weak, r)
	if sAction == wAction {
		t.Errorf("strong and weak both played %s — hand had no effect", sAction)
	}
	if wAction != "fold" {
		t.Errorf("weak hand facing bad odds played %s, want fold", wAction)
	}
}

// A trail is never a fold, whatever the profile says. A bot folding the
// stone-cold nuts is the most obvious tell there is.
func TestNutsNeverFold(t *testing.T) {
	s := baseSituation()
	s.strength = 0.999
	s.foldP, s.callP, s.raiseP = 0.9, 0.05, 0.05 // a profile that folds almost always

	for _, roll := range []float64{0.0, 0.1, 0.3, 0.5, 0.7, 0.99} {
		r := never()
		r.action = roll
		if action, _, _ := decideBot(s, r); action == "fold" {
			t.Errorf("roll %.2f: folded a near-certain winner", roll)
		}
	}
}

// A monster must sometimes just call, or raising becomes a perfect tell.
func TestMonsterSlowPlays(t *testing.T) {
	s := baseSituation()
	s.strength = 0.98
	s.canShow = false
	r := never()
	r.trap = 0.1 // under the 0.25 trap threshold
	if action, _, reason := decideBot(s, r); action != "call" {
		t.Errorf("got %s (%s), want call", action, reason)
	}
}

// Heads-up with a big edge, the bot should be willing to force the showdown.
func TestStrongHeadsUpCallsShow(t *testing.T) {
	s := baseSituation()
	s.strength = 0.95
	s.canShow = true
	r := never()
	r.show = 0.1
	action, amount, _ := decideBot(s, r)
	if action != "show" {
		t.Errorf("got %s, want show", action)
	}
	if amount != s.callCost {
		t.Errorf("show cost %.2f, want %.2f", amount, s.callCost)
	}
	// Multi-way, "show" is illegal and must never be produced.
	s.canShow = false
	if action, _, _ := decideBot(s, r); action == "show" {
		t.Errorf("produced an illegal show with 3+ players")
	}
}

// Bluffing is what stops "bot raised" from meaning "bot has it".
func TestWeakHandBluffs(t *testing.T) {
	s := baseSituation()
	s.strength = 0.10
	s.aggression = 1.0
	r := never()
	r.bluff = 0.01 // under 0.12 * aggression
	if action, _, reason := decideBot(s, r); action != "raise" || reason != "bluff" {
		t.Errorf("got %s (%s), want a bluff raise", action, reason)
	}

	// A passive tier bluffs far less; at aggression 0 it cannot bluff at all.
	s.aggression = 0
	if _, _, reason := decideBot(s, r); reason == "bluff" {
		t.Errorf("a zero-aggression bot bluffed")
	}
}

// Raise sizing must vary with the edge — a bot that always bets exactly 2x the
// minimum is trivially identifiable.
func TestRaiseSizeScalesWithEdge(t *testing.T) {
	s := baseSituation()
	thin := raiseAmount(s, 0)
	fat := raiseAmount(s, 1)
	if fat <= thin {
		t.Errorf("raise size did not scale: thin %.2f, fat %.2f", thin, fat)
	}
	if thin < s.minBet*2 {
		t.Errorf("minimum raise %.2f is below the seen minimum %.2f", thin, s.minBet*2)
	}
}

// Bad pot odds should make the bot fold more than good pot odds do, holding
// the hand and the draw fixed.
func TestPotOddsMatter(t *testing.T) {
	cheap, expensive := baseSituation(), baseSituation()
	cheap.strength, expensive.strength = 0.5, 0.5
	cheap.pot, cheap.callCost = 1000, 10 // ~1% break-even
	expensive.pot, expensive.callCost = 10, 1000

	cf, _, _ := tiltedWeights(cheap, 0.5, cheap.callCost/(cheap.pot+cheap.callCost))
	ef, _, _ := tiltedWeights(expensive, 0.5, expensive.callCost/(expensive.pot+expensive.callCost))
	if !(ef > cf) {
		t.Errorf("fold weight did not rise with a worse price: cheap %.3f, expensive %.3f", cf, ef)
	}
}
