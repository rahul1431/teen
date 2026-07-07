import 'package:flutter/foundation.dart';
import '../network/api_client.dart';

/// App-wide unread-notification count shared between the AppShell bell badge
/// and the notifications page. Call [refresh] after login, when the shell
/// builds, and whenever notifications are read so the badge stays accurate.
class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final ValueNotifier<int> unreadCount = ValueNotifier(0);

  Future<void> refresh() async {
    try {
      final res = await ApiClient().dio.get('/api/notifications/unread-count');
      unreadCount.value = (res.data['count'] as num?)?.toInt() ?? 0;
    } catch (_) {
      // keep the last known count on network errors
    }
  }
}
