import 'dart:async';
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

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    if (_socket?.connected == true) return;
    status.value = 'reading-token';
    final token = await SecureStorage.getAccessToken();
    tokenPresent = token != null && token.isNotEmpty;
    if (token == null || token.isEmpty) {
      status.value = 'no-token';
      lastError.value = 'No auth token — please log in again';
      print('[Socket] connect() skipped: no auth token');
      return;
    }
    status.value = 'connecting to $url';
    // Build options via OptionBuilder so the full Engine.IO option set is
    // populated. Passing a bare Map leaves internal keys unset and trips a
    // "Null check operator used on a null value" crash inside the client.
    // Token is sent as a query param — the gateway reads handshake.query.token.
    _socket = io.io(url, io.OptionBuilder()
        .setTransports(['polling', 'websocket'])
        .setQuery({'token': token})
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
    });
    _socket!.onError((e) {
      lastError.value = e?.toString() ?? 'unknown error';
      print('[Socket] error: $e');
    });
    _socket!.on('connect_error', (e) {
      status.value = 'connect-error';
      lastError.value = e?.toString() ?? 'unknown connect error';
      print('[Socket] connect_error detail: $e');
    });
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
