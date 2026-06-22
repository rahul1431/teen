import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../constants/app_config.dart';
import '../storage/secure_storage.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  io.Socket? _socket;
  final _controllers = <String, StreamController<dynamic>>{};
  // Handlers registered via on() before socket was created; applied in connect().
  final _pendingHandlers = <String, void Function(dynamic)>{};
  void Function()? _reconnectHandler;

  // Observable diagnostics — surfaced in the lobby debug panel so connection
  // problems are visible on-device without adb/server logs.
  final ValueNotifier<String> status = ValueNotifier('idle');
  final ValueNotifier<String> lastError = ValueNotifier('');
  // Trim defensively: a SOCKET_URL build secret with trailing whitespace
  // compiles fine but makes getaddrinfo fail ("Failed host lookup", errno 7).
  String get url => AppConfig.socketUrl.trim();
  bool tokenPresent = false;
  // Guards a single auth-refresh+rebuild attempt per connect cycle so a
  // rejected handshake (expired token) doesn't loop forever.
  bool _retriedAuth = false;

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    if (_socket?.connected == true) return;
    status.value = 'reading-token';
    // The access token expires in 15m. Unlike Dio, the socket does not
    // auto-refresh, so a stale token makes the gateway reject every handshake
    // (surfacing as a "Null check operator" crash inside socket_io_client).
    // Read a fresh token, refreshing first if it is expired/near-expiry.
    final token = await _freshToken();
    tokenPresent = token != null && token.isNotEmpty;
    if (token == null || token.isEmpty) {
      status.value = 'no-token';
      lastError.value = 'No auth token — please log in again';
      print('[Socket] connect() skipped: no auth token');
      return;
    }
    status.value = 'connecting to $url';
    // Send token as Authorization header — the server reads
    // handshake.headers.authorization (index.ts:39) so no setAuth needed,
    // which avoids the v2 null-crash that setAuth triggered on Android.
    _socket = io.io(url, io.OptionBuilder()
        .setTransports(['polling', 'websocket'])
        .setExtraHeaders({'Authorization': 'Bearer $token'})
        .enableAutoConnect()
        .enableReconnection()
        .setReconnectionAttempts(10)
        .setReconnectionDelay(2000)
        .build());

    // Apply event handlers that were registered via on() before socket existed.
    _pendingHandlers.forEach((event, handler) {
      _socket!.on(event, handler);
    });
    _pendingHandlers.clear();

    if (_reconnectHandler != null) {
      _socket!.on('reconnect', (_) => _reconnectHandler!());
    }

    _socket!.onConnect((_) {
      status.value = 'connected';
      lastError.value = '';
      _retriedAuth = false;
      print('[Socket] Connected to ${AppConfig.socketUrl}');
    });
    _socket!.onDisconnect((reason) {
      status.value = 'disconnected: $reason';
      print('[Socket] Disconnected: $reason');
    });
    _socket!.onConnectError((e) {
      status.value = 'connect-error';
      lastError.value = e?.toString() ?? 'unknown connect error';
      print('[Socket] Connect error: $e');
      _handleAuthRejection();
    });
    _socket!.onError((e) {
      lastError.value = e?.toString() ?? 'unknown error';
      print('[Socket] error: $e');
    });
    _socket!.on('connect_error', (e) {
      status.value = 'connect-error';
      lastError.value = e?.toString() ?? 'unknown connect error';
      print('[Socket] connect_error detail: $e');
      _handleAuthRejection();
    });
  }

  // A rejected handshake (commonly an expired token) shows up as a connect
  // error. Refresh the token once and rebuild the socket with the fresh value
  // (socket_io_client bakes the query in at creation, so we must recreate).
  Future<void> _handleAuthRejection() async {
    if (_retriedAuth) return;
    _retriedAuth = true;
    final refreshed = await _refreshAccessToken();
    if (!refreshed) return;
    status.value = 'auth-refreshed, reconnecting';
    _socket?.dispose();
    _socket = null;
    await connect();
  }

  // Returns a non-expired access token, refreshing via the auth service first
  // when the stored token is expired or within 30s of expiry.
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

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    final handler = (dynamic data) => _controllers[event]!.add(data);
    if (_socket != null) {
      _socket!.on(event, handler);
    } else {
      // Socket not created yet; store handler and apply it in connect().
      _pendingHandlers[event] = handler;
    }
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) {
    if (_socket == null) {
      print('[Socket] emit($event) dropped — socket not initialized');
      return;
    }
    _socket!.emit(event, data);
  }

  void onReconnect(void Function() handler) {
    _reconnectHandler = handler;
    _socket?.on('reconnect', (_) => handler());
  }

  void disconnect() {
    _socket?.disconnect();
    for (final c in _controllers.values) { c.close(); }
    _controllers.clear();
    _pendingHandlers.clear();
    _reconnectHandler = null;
  }
}

// Aviator-specific socket (separate namespace)
class AviatorSocketService {
  static final AviatorSocketService _instance = AviatorSocketService._internal();
  factory AviatorSocketService() => _instance;
  AviatorSocketService._internal();

  io.Socket? _socket;
  final _controllers = <String, StreamController<dynamic>>{};

  Future<void> connect() async {
    if (_socket?.connected == true) return;
    final token = await SecureStorage.getAccessToken();
    _socket = io.io(AppConfig.socketUrl.trim(), io.OptionBuilder()
        .setTransports(['polling', 'websocket'])
        .setPath('/aviator/')
        .setAuth({'token': token})
        .enableAutoConnect()
        .enableReconnection()
        .build());
  }

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    _socket?.on(event, (data) => _controllers[event]!.add(data));
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) => _socket?.emit(event, data);

  void disconnect() {
    _socket?.disconnect();
    for (final c in _controllers.values) { c.close(); }
    _controllers.clear();
  }
}
