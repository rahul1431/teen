// Parity check for the Dart port of findValidDeclareGrouping — the offline
// half of the "server computes the declare grouping" fix. The same three
// hands are asserted in services/game-engines/rummy/src/rules.test.ts; if the
// two implementations ever drift, one of these will fail.
import 'package:flutter_test/flutter_test.dart';
import 'package:myonlinejoker/features/games/rummy/rummy_engine.dart';

RummyCard c(String id, String rank, String suit) => RummyCard(id, rank, suit);

void main() {
  final engine = RummyEngine();

  test('finds a declare a greedy melding would miss', () {
    // Greedy takes the 4-card set of 5s first, stealing S5 out of the
    // S4-S5-S6-S7 run and stranding S4/S6/S7.
    final hand = [
      c('a1', '5', 'D'), c('a2', '5', 'C'), c('a3', '5', 'H'), c('a4', '5', 'S'),
      c('b1', '4', 'S'), c('b2', '6', 'S'), c('b3', '7', 'S'),
      c('d1', '2', 'H'), c('d2', '3', 'H'), c('d3', '4', 'H'),
      c('e1', '9', 'D'), c('e2', '9', 'C'), c('e3', '9', 'S'),
      c('z1', 'K', 'C'),
    ];
    final groups = engine.findValidDeclareGrouping(hand, '__NONE__');
    expect(groups, isNotNull);
    final flat = groups!.expand((g) => g).toList();
    expect(flat.length, 13);
    expect(flat.toSet().length, 13);
    // Sanity: the grouping the search returns must actually win.
    final state = RummyEngineState(
      players: [RummyPlayerState('me', 'You', false)],
      closedPile: [],
      openPile: [],
      wildRank: '__NONE__',
    );
    state.players[0].hand = hand;
    expect(engine.declare(state, 0, groups), isTrue);
  });

  test('returns null for a hand with no meld at all', () {
    final junk = [
      c('1', '2', 'S'), c('2', '4', 'H'), c('3', '6', 'D'), c('4', '8', 'C'),
      c('5', '10', 'S'), c('6', 'Q', 'H'), c('7', 'A', 'D'), c('8', '3', 'C'),
      c('9', '5', 'S'), c('10', '7', 'H'), c('11', '9', 'D'), c('12', 'J', 'C'),
      c('13', 'K', 'S'), c('14', '2', 'H'),
    ];
    expect(engine.findValidDeclareGrouping(junk, '__NONE__'), isNull);
  });

  test('returns null when the hand melds fully but yields only one sequence', () {
    final oneSequence = [
      c('s1', 'A', 'S'), c('s2', 'A', 'H'), c('s3', 'A', 'D'), c('s4', 'A', 'C'),
      c('t1', '7', 'S'), c('t2', '7', 'H'), c('t3', '7', 'D'),
      c('u1', '9', 'S'), c('u2', '9', 'H'), c('u3', '9', 'D'),
      c('v1', '4', 'S'), c('v2', '5', 'S'), c('v3', '6', 'S'),
      c('z1', 'K', 'C'),
    ];
    expect(engine.findValidDeclareGrouping(oneSequence, '__NONE__'), isNull);
  });
}
