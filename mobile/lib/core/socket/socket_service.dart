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
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  Timer? _pingTimer;

  // Observable diagnostics — surfaced in the lobby debug panel.
  final ValueNotifier<String> status = ValueNotifier('idle');
  final ValueNotifier<String> lastError = ValueNotifier('');
  bool tokenPresent = false;

  // Trim defensively: a SOCKET_URL build secret with trailing whitespace
  // compiles fine but breaks host resolution.
  String get url => AppConfig.socketUrl.trim();
  bool get isConnected => _connected;

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
    status.value = 'reading-token';

    // The access token expires in 15m. Unlike Dio, the socket does not
    // auto-refresh, so read a fresh token (refreshing first if expired).
    final token = await _freshToken();
    tokenPresent = token != null && token.isNotEmpty;
    if (token == null || token.isEmpty) {
      status.value = 'no-token';
      lastError.value = 'No auth token — please log in again';
      _connecting = false;
      print('[Socket] connect() skipped: no auth token');
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
    _connected = false;
    _pingTimer?.cancel();
    _sub?.cancel();
    _sub = null;
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
      connect();
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

  // --- Token freshness (access token expires in 15m) ---

  Future<String?> _freshToken() async {
    final token = await SecureStorage.getAccessToken();
    if (token == null || token.isEmpty) return null;
    if (!_isExpired(token)) return token;
    final refreshed = await _refreshAccessToken();
    return refreshed ? await SecureStorage.getAccessToken() : token;
  }

  bool _isExpired(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return false;
      final payload = json.decode(
          utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
      final exp = payload['exp'];
      if (exp is! int) return false;
      final expiry = DateTime.fromMillisecondsSinceEpoch(exp * 1000);
      return DateTime.now().isAfter(expiry.subtract(const Duration(seconds: 30)));
    } catch (_) {
      return false;
    }
  }

  Future<bool> _refreshAccessToken() async {
    try {
      final refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken == null) return false;
      final res = await Dio().post(
        '${AppConfig.apiBaseUrl.trim()}/api/auth/refresh',
        data: {'refresh_token': refreshToken},
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
    } catch (e) {
      print('[AviatorSocket] connect error: $e');
      _channel = null;
      _connecting = false;
      _scheduleReconnect();
    }
  }

  void _onClosed() {
    _sub?.cancel();
    _sub = null;
    _channel = null;
    _connecting = false;
    if (!_manuallyClosed) _scheduleReconnect();
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 4), connect);
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
