import '../socket/socket_service.dart';
import 'monitor_service.dart';

/// Attaches listeners to SocketService's public ValueNotifiers to track
/// WebSocket connection lifecycle events without modifying SocketService itself.
class SocketMonitorWrapper {
  final SocketService _socket;
  int _reconnectAttempt = 0;
  String? _prevStatus;

  SocketMonitorWrapper(this._socket) {
    _socket.status.addListener(_onStatusChange);
  }

  void _onStatusChange() {
    try {
      final newStatus = _socket.status.value;
      if (newStatus == _prevStatus) return;
      _prevStatus = newStatus;

      if (newStatus == 'connected') {
        _reconnectAttempt = 0;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'connected',
        });
      } else if (newStatus.contains('reconnect') || newStatus.contains('retry')) {
        _reconnectAttempt++;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'reconnect',
          'properties': {'attempt': _reconnectAttempt},
        });
      } else if (newStatus == 'disconnected' || newStatus.contains('disconnect')) {
        final errMsg = _socket.lastError.value;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'disconnected',
          if (errMsg.isNotEmpty)
            'error_message': errMsg.substring(0, errMsg.length.clamp(0, 200)),
        });
      } else if (newStatus.contains('error') ||
          newStatus.contains('failed') ||
          newStatus == 'no-token') {
        final errMsg = _socket.lastError.value.isNotEmpty
            ? _socket.lastError.value
            : newStatus;
        MonitorService.instance.enqueue({
          'event_type': 'ws_event',
          'ws_status': 'error',
          'error_message': errMsg.substring(0, errMsg.length.clamp(0, 200)),
        });
      }
    } catch (_) {}
  }

  void dispose() {
    _socket.status.removeListener(_onStatusChange);
  }
}
