import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

/// Named sound effects used across all games. The string value is the asset
/// filename under `assets/sounds/`.
enum Sfx {
  buttonTap('button_tap.mp3'),
  // Ludo
  diceRoll('dice_roll.mp3'),
  tokenMove('token_move.mp3'),
  tokenCapture('token_capture.mp3'),
  tokenHome('token_home.mp3'),
  // Teen Patti
  cardDeal('card_deal.mp3'),
  chipBet('chip_bet.mp3'),
  // Aviator
  takeoff('aviator_takeoff.mp3'),
  tick('aviator_tick.mp3'),
  cashout('aviator_cashout.mp3'),
  crash('aviator_crash.mp3'),
  countdown('countdown.mp3'),
  // Shared outcomes
  win('win.mp3'),
  lose('lose.mp3'),
  yourTurn('your_turn.mp3');

  const Sfx(this.asset);
  final String asset;
}

/// Lightweight SFX player shared by every game.
///
/// Design goals:
///  - **Never throws / never blocks gameplay.** A missing asset or a platform
///    audio error is swallowed — the game keeps running silently.
///  - **Pooled players** so overlapping effects (e.g. rapid dice + capture)
///    don't cut each other off.
///  - **Global mute** persisted by the caller (settings) and honoured here.
class SoundService {
  SoundService._();
  static final SoundService instance = SoundService._();

  static const _poolSize = 4;
  final List<AudioPlayer> _pool =
      List.generate(_poolSize, (_) => AudioPlayer(playerId: 'sfx_$_'));
  int _next = 0;

  bool _muted = false;
  bool get muted => _muted;
  set muted(bool v) => _muted = v;
  void toggleMute() => _muted = !_muted;

  /// Optional long-running ambience (e.g. table felt loop). Kept separate from
  /// the one-shot pool so it can loop and be stopped independently.
  final AudioPlayer _ambience = AudioPlayer(playerId: 'sfx_ambience');

  bool _ready = false;

  /// Configure players once. Safe to call multiple times.
  Future<void> init() async {
    if (_ready) return;
    _ready = true;
    try {
      for (final p in _pool) {
        await p.setReleaseMode(ReleaseMode.stop);
        await p.setPlayerMode(PlayerMode.lowLatency);
      }
      await _ambience.setReleaseMode(ReleaseMode.loop);
    } catch (e) {
      if (kDebugMode) debugPrint('[Sound] init skipped: $e');
    }
  }

  /// Play a one-shot effect. Returns immediately; failures are ignored.
  Future<void> play(Sfx sfx, {double volume = 1.0}) async {
    if (_muted) return;
    final player = _pool[_next];
    _next = (_next + 1) % _poolSize;
    try {
      await player.stop();
      await player.play(AssetSource('sounds/${sfx.asset}'), volume: volume);
    } catch (e) {
      // Missing asset or unsupported platform — stay silent.
      if (kDebugMode) debugPrint('[Sound] ${sfx.asset} skipped: $e');
    }
  }

  Future<void> loopAmbience(String asset, {double volume = 0.4}) async {
    if (_muted) return;
    try {
      await _ambience.play(AssetSource('sounds/$asset'), volume: volume);
    } catch (_) {/* ignore */}
  }

  Future<void> stopAmbience() async {
    try {
      await _ambience.stop();
    } catch (_) {/* ignore */}
  }

  Future<void> dispose() async {
    for (final p in _pool) {
      await p.dispose();
    }
    await _ambience.dispose();
  }
}
