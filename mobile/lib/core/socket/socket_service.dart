import 'dart:async';
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

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    if (_socket?.connected == true) return;
    final token = await SecureStorage.getAccessToken();
    if (token == null) {
      print('[Socket] connect() skipped: no auth token');
      return;
    }
    _socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .setAuth({'token': token})
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

    _socket!.onConnect((_) => print('[Socket] Connected to ${AppConfig.socketUrl}'));
    _socket!.onDisconnect((reason) => print('[Socket] Disconnected: $reason'));
    _socket!.onConnectError((e) => print('[Socket] Connect error: $e'));
    _socket!.on('connect_error', (e) => print('[Socket] connect_error detail: $e'));
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
    _socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket', 'polling'])
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
