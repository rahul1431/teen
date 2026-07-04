import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as ws_status;
import '../constants/app_config.dart';
import '../storage/secure_storage.dart';

/// Realtime client over a raw WebSocket (the gateway exposes /ws).
///
/// The wire protocol is JSON `{ "event": <name>, "data": <payload> }` in both
/// directions. The public API (connect / on / emit / onReconnect / status)
/// matches the previous Socket.IO-based service, so callers are unchanged.
class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  final _controllers = <String, StreamController<dynamic>>{};
  void Function()? _reconnectHandler;

  bool _connecting = false;
  bool _connected = false;
  bool _manuallyClosed = false;
  bool _closedHandled = false; // prevents double _onClosed() when both onError+onDone fire
  bool _autoReconnecting = false; // true only when _scheduleReconnect timer fires connect()
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  Timer? _pingTimer;

  // When true, _freshToken() forces a refresh even if the token hasn't expired
  // by clock. Set when the server closes with code 4001 (token rejected).
  bool _forceRefresh = false;

  // Observable diagnostics — surfaced in the lobby debug panel.
  final ValueNotifier<String> status = ValueNotifier('idle');
  final ValueNotifier<String> lastError = ValueNotifier('');
  bool tokenPresent = false;

  // Trim defensively: a SOCKET_URL build secret with trailing whitespace
  // compiles fine but breaks host resolution.
  String get url => AppConfig.socketUrl.trim();
  bool get isConnected => _connected;

  /// Called by AviatorSocketService when it receives close code 4001.
  void markForceRefresh() => _forceRefresh = true;

  /// WebSocket endpoint: https://host -> wss://host/ws (and ws:// for http).
  Uri _wsUri(String token) {
    var base = url;
    if (base.startsWith('https://')) {
      base = 'wss://${base.substring('https://'.length)}';
    } else if (base.startsWith('http://')) {
      base = 'ws://${base.substring('http://'.length)}';
    }
    base = base.replaceAll(RegExp(r'/+$'), '');
    return Uri.parse('$base/ws?token=${Uri.encodeComponent(token)}');
  }

  Future<void> connect() async {
    if (_connected || _connecting) return;
    _connecting = true;
    _manuallyClosed = false;
    _closedHandled = false; // arm the guard for this new connection lifecycle

    // External calls (from lobbies) always reset the counter so the user gets
    // a fresh 20-attempt window. Internal timer-driven reconnects do NOT reset.
    if (!_autoReconnecting) _reconnectAttempts = 0;

    status.value = 'reading-token';

    String? token;
    try {
      token = await _freshToken();
    } catch (_) {
      token = null;
    }
    tokenPresent = token != null && token.isNotEmpty;

    if (token == null || token.isEmpty) {
      _connecting = false;
      print('[Socket] connect(): no token / refresh failed');
      if (!_manuallyClosed && _reconnectAttempts < 4) {
        // Refresh may have failed due to a transient network error — retry.
        status.value = 'auth-retry';
        lastError.value = 'Token refresh failed — retrying in 8s';
        _reconnectAttempts++;
        _reconnectTimer = Timer(const Duration(seconds: 8), () {
          _channel = null;
          connect();
        });
      } else {
        status.value = 'no-token';
        lastError.value = 'Session expired — please log in again';
      }
      return;
    }

    final uri = _wsUri(token);
    status.value = 'connecting to ${uri.host}';
    print('[Socket] connecting to $uri');

    try {
      _channel = WebSocketChannel.connect(uri);
      // ready completes once the underlying socket is open (or throws).
      await _channel!.ready;
    } catch (e) {
      _connecting = false;
      _connected = false;
      status.value = 'connect-error';
      lastError.value = e.toString();
      print('[Socket] connect error: $e');
      _scheduleReconnect();
      return;
    }

    _connecting = false;
    _connected = true;
    _reconnectAttempts = 0;
    status.value = 'connected';
    lastError.value = '';
    print('[Socket] connected');

    _sub = _channel!.stream.listen(
      _onFrame,
      onError: (e) {
        lastError.value = e.toString();
        status.value = 'error';
        print('[Socket] stream error: $e');
        _onClosed();
      },
      onDone: () {
        print('[Socket] closed (code=${_channel?.closeCode})');
        _onClosed();
      },
      cancelOnError: true,
    );

    _startPing();
    _reconnectHandler?.call();
    _controllers['reconnect']?.add(null);
  }

  void _onFrame(dynamic raw) {
    if (raw is! String) return;
    Map<String, dynamic> msg;
    try {
      msg = json.decode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final event = msg['event'] as String?;
    if (event == null) return;
    _controllers[event]?.add(msg['data']);
  }

  void _onClosed() {
    // web_socket_channel can fire both onError (cancelOnError:true) AND onDone
    // for the same close event, doubling _reconnectAttempts and exhausting the
    // 20-attempt cap after only 10 real disconnects. Guard against this.
    if (_closedHandled) return;
    _closedHandled = true;

    final code = _channel?.closeCode;
    _connected = false;
    _pingTimer?.cancel();
    _sub?.cancel();
    _sub = null;

    // Server closes with 4001 when the token is invalid or expired.
    // Force a fresh refresh on the next connect attempt.
    if (code == 4001) {
      _forceRefresh = true;
      print('[Socket] close 4001 — will force token refresh before next connect');
    }

    if (_manuallyClosed) {
      status.value = 'disconnected';
      return;
    }
    status.value = 'disconnected — reconnecting';
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (_manuallyClosed) return;
    _reconnectTimer?.cancel();
    if (_reconnectAttempts >= 20) {
      status.value = 'reconnect-failed';
      return;
    }
    // Exponential backoff capped at 16s.
    final delaySec = [2, 2, 4, 4, 8, 8, 16][_reconnectAttempts.clamp(0, 6)];
    _reconnectAttempts++;
    _reconnectTimer = Timer(Duration(seconds: delaySec), () {
      _channel = null;
      _autoReconnecting = true;
      connect().whenComplete(() => _autoReconnecting = false);
    });
  }

  /// Force-restart the reconnect cycle (resets attempt counter).
  /// Call this from UI when status == 'reconnect-failed'.
  void reconnectNow() {
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
    _manuallyClosed = false;
    _channel = null;
    status.value = 'reconnecting…';
    connect();
  }

  void _startPing() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      emit('ping', {'timestamp': DateTime.now().millisecondsSinceEpoch});
    });
  }

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) {
    if (_channel == null || !_connected) {
      print('[Socket] emit($event) dropped — not connected');
      return;
    }
    _channel!.sink.add(json.encode({'event': event, 'data': data ?? {}}));
  }

  /// Re-invoked after every successful (re)connect so callers can re-establish
  /// state (e.g. re-join the matchmaking queue).
  void onReconnect(void Function() handler) {
    _reconnectHandler = handler;
  }

  void disconnect() {
    _manuallyClosed = true;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _connected = false;
    for (final c in _controllers.values) {
      c.close();
    }
    _controllers.clear();
    _reconnectHandler = null;
  }

  // --- Token freshness ---

  Future<String?> _freshToken() async {
    final token = await SecureStorage.getAccessToken();
    if (token == null || token.isEmpty) return null;

    final needsRefresh = _forceRefresh || _isExpired(token);
    if (!needsRefresh) return token;

    _forceRefresh = false;
    final refreshed = await _refreshAccessToken();
    // Do NOT fall back to the expired token on refresh failure — that causes
    // an infinite 4001 rejection loop. Return null so connect() schedules a
    // retry instead.
    if (!refreshed) return null;
    return await SecureStorage.getAccessToken();
  }

  bool _isExpired(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return true;
      final payload = json.decode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      final exp = payload['exp'];
      if (exp is! int) return true;
      final expiry = DateTime.fromMillisecondsSinceEpoch(exp * 1000);
      return DateTime.now().isAfter(expiry.subtract(const Duration(seconds: 30)));
    } catch (_) {
      return true;
    }
  }

  Future<bool> _refreshAccessToken() async {
    try {
      final refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken == null) return false;
      final res = await Dio().post(
        '${AppConfig.apiBaseUrl.trim()}/api/auth/refresh',
        data: {'refresh_token': refreshToken},
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
        ),
      );
      await SecureStorage.saveTokens(
        accessToken: res.data['access_token'],
        refreshToken: refreshToken,
      );
      print('[Socket] access token refreshed');
      return true;
    } catch (e) {
      print('[Socket] token refresh failed: $e');
      return false;
    }
  }
}

// Aviator-specific realtime client (separate /ws/aviator endpoint).
class AviatorSocketService {
  static final AviatorSocketService _instance = AviatorSocketService._internal();
  factory AviatorSocketService() => _instance;
  AviatorSocketService._internal();

  WebSocketChannel? _channel;
  StreamSubscription? _sub;
  final _controllers = <String, StreamController<dynamic>>{};
  bool _manuallyClosed = false;
  bool _connecting = false;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;

  String get _base {
    var b = AppConfig.socketUrl.trim();
    if (b.startsWith('https://')) b = 'wss://${b.substring(8)}';
    else if (b.startsWith('http://')) b = 'ws://${b.substring(7)}';
    return b.replaceAll(RegExp(r'/+$'), '');
  }

  Future<void> connect() async {
    _manuallyClosed = false; // reset so re-navigation to the page reconnects
    if (_channel != null || _connecting) return;
    _connecting = true;
    if (_reconnectAttempts >= 20) _reconnectAttempts = 0;
    // Use the main SocketService's token refresh so Aviator always has a fresh token.
    final token = await SocketService()._freshToken();
    if (token == null || token.isEmpty) {
      _connecting = false;
      _scheduleReconnect();
      return;
    }
    final uri = Uri.parse('$_base/ws/aviator?token=${Uri.encodeComponent(token)}');
    try {
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _sub = _channel!.stream.listen(
        (raw) {
          if (raw is! String) return;
          try {
            final msg = json.decode(raw) as Map<String, dynamic>;
            final event = msg['event'] as String?;
            if (event != null) _controllers[event]?.add(msg['data']);
          } catch (_) {}
        },
        onError: (_) => _onClosed(),
        onDone:  () => _onClosed(),
        cancelOnError: true,
      );
      _connecting = false;
      _reconnectAttempts = 0;
    } catch (e) {
      print('[AviatorSocket] connect error: $e');
      _channel = null;
      _connecting = false;
      _scheduleReconnect();
    }
  }

  void _onClosed() {
    final code = _channel?.closeCode;
    _sub?.cancel();
    _sub = null;
    _channel = null;
    _connecting = false;
    // Tell the main service to force-refresh the token before next attempt.
    if (code == 4001) {
      SocketService().markForceRefresh();
      print('[AviatorSocket] close 4001 — will force token refresh');
    }
    if (!_manuallyClosed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    if (_reconnectAttempts >= 20) {
      print('[AviatorSocket] max reconnect attempts reached — giving up');
      return;
    }
    final delaySec = [2, 2, 4, 4, 8, 8, 16][_reconnectAttempts.clamp(0, 6)];
    _reconnectAttempts++;
    _reconnectTimer = Timer(Duration(seconds: delaySec), connect);
  }

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) {
    _channel?.sink.add(json.encode({'event': event, 'data': data ?? {}}));
  }

  void disconnect() {
    _manuallyClosed = true;
    _reconnectTimer?.cancel();
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close(ws_status.normalClosure);
    _channel = null;
    _connecting = false;
    for (final c in _controllers.values) {
      c.close();
    }
    _controllers.clear();
  }
}
