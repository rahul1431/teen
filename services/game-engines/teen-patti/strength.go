package main

import (
	"sort"
	"sync"
)

// Hand strength as an exact percentile.
//
// A bot needs a single 0..1 number for "how good is this hand", and the obvious
// shortcuts are both wrong: hand *rank* alone treats A-A-A and 2-2-2 as equal,
// and a hand-crafted points table is a guess that drifts from the real
// evaluator the moment either changes.
//
// Instead we enumerate all C(52,3) = 22,100 three-card hands once, score them
// with the same evaluateHand() the showdown uses, and read a hand's strength as
// the fraction of hands it beats. That makes strength *definitionally*
// consistent with who actually wins, and it costs one 22k-iteration pass at
// process start (a few milliseconds), not per decision.
//
// Ties are counted as half, so a hand that beats 60% and ties 4% scores 0.62 —
// otherwise every pair of the same rank would read as strictly better or worse
// than itself depending on which side of the search we took.

var (
	strengthOnce sync.Once
	// Ascending, one entry per possible hand. Duplicates are meaningful: the
	// number of times a key appears is how many of the 22,100 hands are exactly
	// that strong, which is what makes the percentile correct.
	handKeys []int
)

// handKey packs an evaluated hand into a single ordering-preserving integer.
// Score never exceeds 1600 (the A-2-3 pure-sequence special case), so a 10,000
// multiplier on rank keeps ranks from ever overlapping.
func handKey(h HandResult) int {
	return h.Rank*10000 + h.Score
}

// orderedDeck builds the 52 cards in a fixed order. newDeck() would do, but it
// shuffles with crypto/rand — pointless entropy for an enumeration where only
// the set matters, not the order.
func orderedDeck() []Card {
	deck := make([]Card, 0, 52)
	for _, suit := range []string{Spades, Hearts, Diamonds, Clubs} {
		for _, val := range values {
			deck = append(deck, Card{Value: val, Suit: suit, Rank: rankCard(val)})
		}
	}
	return deck
}

func buildStrengthTable() {
	deck := orderedDeck()
	handKeys = make([]int, 0, 22100)
	for i := 0; i < len(deck); i++ {
		for j := i + 1; j < len(deck); j++ {
			for k := j + 1; k < len(deck); k++ {
				handKeys = append(handKeys, handKey(evaluateHand([]Card{deck[i], deck[j], deck[k]})))
			}
		}
	}
	sort.Ints(handKeys)
}

// handStrength returns where this hand sits in the distribution of all possible
// hands, from 0 (worst) to 1 (best), under the table's variation.
//
// Muflis inverts the ranking, so its strength is the classic percentile
// mirrored. Wild variations (AK47, Joker) are evaluated with their wilds
// applied and then read off the *classic* distribution — that slightly
// overstates strength, because opponents hold wilds too and the whole
// distribution shifts up. It is a known, bounded optimism rather than a
// silently wrong number, and it errs toward the bot betting a wild-improved
// hand confidently, which is what a human does with one.
func handStrength(variation string, jokerRank int, cards []Card) float64 {
	if len(cards) != 3 {
		return 0
	}
	strengthOnce.Do(buildStrengthTable)

	key := handKey(evaluateHandVariant(variation, jokerRank, cards))
	worse := sort.SearchInts(handKeys, key)      // count strictly below
	notBetter := sort.SearchInts(handKeys, key+1) // count at or below
	s := (float64(worse) + float64(notBetter)) / 2 / float64(len(handKeys))

	if variation == "muflis" {
		return 1 - s
	}
	return s
}
