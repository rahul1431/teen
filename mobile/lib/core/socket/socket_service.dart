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

  bool get isConnected => _socket?.connected ?? false;

  Future<void> connect() async {
    if (_socket?.connected == true) return;
    final token = await SecureStorage.getAccessToken();
    _socket = io.io(AppConfig.socketUrl, io.OptionBuilder()
        .setTransports(['websocket'])
        .setAuth({'token': token})
        .enableAutoConnect()
        .enableReconnection()
        .setReconnectionAttempts(10)
        .setReconnectionDelay(2000)
        .build());

    _socket!.onConnect((_) => print('[Socket] Connected'));
    _socket!.onDisconnect((_) => print('[Socket] Disconnected'));
    _socket!.onConnectError((e) => print('[Socket] Error: $e'));
  }

  Stream<dynamic> on(String event) {
    _controllers[event] ??= StreamController<dynamic>.broadcast();
    _socket?.on(event, (data) => _controllers[event]!.add(data));
    return _controllers[event]!.stream;
  }

  void emit(String event, [dynamic data]) => _socket?.emit(event, data);

  void onReconnect(void Function() handler) {
    _socket?.on('reconnect', (_) => handler());
  }

  void disconnect() {
    _socket?.disconnect();
    for (final c in _controllers.values) { c.close(); }
    _controllers.clear();
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
        .setTransports(['websocket'])
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
