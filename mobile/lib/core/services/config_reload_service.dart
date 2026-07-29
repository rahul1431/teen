import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../network/api_client.dart';
import '../socket/socket_service.dart';
import '../constants/socket_events.dart';

/// Listens for game config reload events from the server and triggers
/// a refresh of cached game configurations.
class ConfigReloadService {
  static final ConfigReloadService _instance = ConfigReloadService._internal();
  factory ConfigReloadService() => _instance;
  ConfigReloadService._internal();

  final SocketService _socket = SocketService();
  StreamSubscription? _configVersionSub;
  StreamSubscription? _configReloadSub;

  // Called when a config reload is triggered (override in tests or app-level)
  void Function(String gameType)? onConfigReload;

  void init() {
    // Listen for initial config version handshake
    _configVersionSub = _socket.on(SocketEvents.configVersion).listen(
      (data) {
        final checkingAt = data?['checkingAt'] as String?;
        if (kDebugMode) {
          print('[ConfigReload] Version check at $checkingAt');
        }
      },
      onError: (e) {
        if (kDebugMode) {
          print('[ConfigReload] configVersion error: $e');
        }
      },
    );

    // Listen for config reload events at runtime
    _configReloadSub = _socket.on(SocketEvents.configReload).listen(
      (data) async {
        final gameType = data?['gameType'] as String?;
        final reloadedAt = data?['reloadedAt'] as String?;

        if (kDebugMode) {
          print('[ConfigReload] Reload triggered for $gameType at $reloadedAt');
        }

        if (gameType != null) {
          try {
            // Clear local cache for this game type
            await _clearGameConfigCache(gameType);

            // Fetch fresh config from backend
            await _refreshGameConfig(gameType);

            // Notify listeners (e.g., state managers, BLoCs)
            onConfigReload?.call(gameType);

            if (kDebugMode) {
              print('[ConfigReload] Refresh complete for $gameType');
            }
          } catch (e) {
            if (kDebugMode) {
              print('[ConfigReload] Refresh failed: $e');
            }
          }
        }
      },
      onError: (e) {
        if (kDebugMode) {
          print('[ConfigReload] configReload error: $e');
        }
      },
    );
  }

  /// Clear the local game config cache for a specific game type.
  Future<void> _clearGameConfigCache(String gameType) async {
    try {
      final box = await Hive.openBox('game_configs');
      await box.delete(gameType);
      if (kDebugMode) {
        print('[ConfigReload] Cleared cache for $gameType');
      }
    } catch (e) {
      if (kDebugMode) {
        print('[ConfigReload] Failed to clear cache for $gameType: $e');
      }
    }
  }

  /// Fetch fresh game config from the backend REST API.
  ///
  /// Uses the app's shared ApiClient (built on AppConfig.apiBaseUrl, with an
  /// auth interceptor that attaches the bearer token and handles 401
  /// refresh) rather than a bare Dio() instance — a fresh Dio() has no
  /// baseUrl configured, so a relative path like '/api/game-configs/...'
  /// never resolves to a real request. See
  /// docs/Bugs/config-reload-dead-feature.md.
  Future<void> _refreshGameConfig(String gameType) async {
    try {
      final response = await ApiClient().dio.get('/api/game-configs/$gameType');

      if (response.statusCode == 200) {
        final box = await Hive.openBox('game_configs');
        await box.put(gameType, response.data);
        if (kDebugMode) {
          print('[ConfigReload] Fetched fresh config for $gameType');
        }
      }
    } catch (e) {
      if (kDebugMode) {
        print('[ConfigReload] Failed to fetch fresh config: $e');
      }
      rethrow;
    }
  }

  void dispose() {
    _configVersionSub?.cancel();
    _configReloadSub?.cancel();
  }
}
