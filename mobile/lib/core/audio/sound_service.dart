import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:hive/hive.dart';

/// Named sound effects used across all games. The string value is the asset
/// filename under `assets/sounds/`.
enum Sfx {
  buttonTap('button_tap.mp3'),
  // Ludo — licensed original sounds
  diceRoll('Ludo King Orginal Sound With licensed/diceroll.mp3'),
  tokenMove('Ludo King Orginal Sound With licensed/step.mp3'),
  tokenCapture('Ludo King Orginal Sound With licensed/death.mp3'),
  tokenHome('Ludo King Orginal Sound With licensed/panta.mp3'),
  ludoWin('Ludo King Orginal Sound With licensed/congratulations.mp3'),
  ludoStart('Ludo King Orginal Sound With licensed/gamestartsound.mp3'),
  ludoSafe('Ludo King Orginal Sound With licensed/safe.mp3'),
  ludoTap('Ludo King Orginal Sound With licensed/click.mp3'),
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
  bool get muted {
    try {
      final box = Hive.box('settings');
      return box.get('muted', defaultValue: false) as bool;
    } catch (_) {
      return _muted;
    }
  }

  set muted(bool v) {
    _muted = v;
    try {
      Hive.box('settings').put('muted', v);
    } catch (_) {}
  }

  void toggleMute() {
    muted = !muted;
  }

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
        // NOTE: deliberately NOT PlayerMode.lowLatency — on Android that maps
        // to SoundPool, which plays silently when the sample hasn't finished
        // loading (and every stop()+play() here reloads the asset). The
        // default MediaPlayer mode trades a few ms of latency for actually
        // audible effects.
        await p.setPlayerMode(PlayerMode.mediaPlayer);
      }
      await _ambience.setReleaseMode(ReleaseMode.loop);
    } catch (e) {
      if (kDebugMode) debugPrint('[Sound] init skipped: $e');
    }
  }

  /// Play a one-shot effect. Returns immediately; failures are ignored.
  Future<void> play(Sfx sfx, {double volume = 1.0}) async {
    if (muted) return;
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
    if (muted) return;
    try {
      // Set explicitly right before play() instead of relying on init()'s
      // setReleaseMode having already landed — init() isn't awaited by
      // callers, so a race let ambience start in the default (non-looping)
      // release mode and stop after one playthrough.
      await _ambience.setReleaseMode(ReleaseMode.loop);
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
