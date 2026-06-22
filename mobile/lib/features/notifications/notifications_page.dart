import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});
  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List<dynamic> _notifications = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/notifications/me');
      if (mounted) setState(() { _notifications = res.data as List; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markRead(String id, int index) async {
    try {
      await ApiClient().dio.put('/api/notifications/read/$id');
      if (mounted) {
        setState(() {
          _notifications[index] = {...Map<String, dynamic>.from(_notifications[index]), 'read': true};
        });
      }
    } catch (_) {}
  }

  Future<void> _markAllRead() async {
    for (int i = 0; i < _notifications.length; i++) {
      if (_notifications[i]['read'] == false) {
        await _markRead(_notifications[i]['id'] as String, i);
      }
    }
  }

  IconData _icon(String type) {
    switch (type) {
      case 'win':        return Icons.emoji_events_rounded;
      case 'deposit':    return Icons.account_balance_wallet_rounded;
      case 'withdrawal': return Icons.payments_rounded;
      case 'kyc':        return Icons.verified_user_rounded;
      case 'bonus':      return Icons.card_giftcard_rounded;
      case 'broadcast':  return Icons.campaign_rounded;
      default:           return Icons.notifications_rounded;
    }
  }

  Color _iconColor(String type) {
    switch (type) {
      case 'win':        return AppColors.gold;
      case 'deposit':    return AppColors.green;
      case 'withdrawal': return AppColors.orange;
      case 'kyc':        return AppColors.blue;
      case 'bonus':      return AppColors.gold;
      case 'broadcast':  return AppColors.purple;
      default:           return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasUnread = _notifications.any((n) => n['read'] == false);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (hasUnread)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('Mark all read', style: TextStyle(color: AppColors.gold, fontSize: 13)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
          : _notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.notifications_none_rounded, size: 64, color: AppColors.textSecondary.withOpacity(0.4)),
                      const SizedBox(height: 12),
                      const Text('No notifications yet', style: TextStyle(color: AppColors.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.gold,
                  backgroundColor: AppColors.surface,
                  child: ListView.separated(
                    itemCount: _notifications.length,
                    separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                    itemBuilder: (_, i) => _buildItem(_notifications[i], i),
                  ),
                ),
    );
  }

  Widget _buildItem(Map<String, dynamic> n, int i) {
    final isRead = n['read'] == true;
    final type = n['type'] as String? ?? '';
    final color = _iconColor(type);
    return InkWell(
      onTap: isRead ? null : () => _markRead(n['id'] as String, i),
      child: Container(
        color: isRead ? Colors.transparent : AppColors.gold.withOpacity(0.05),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(shape: BoxShape.circle, color: color.withOpacity(0.15)),
              child: Icon(_icon(type), color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          n['title'] as String? ?? '',
                          style: TextStyle(fontWeight: isRead ? FontWeight.normal : FontWeight.bold, fontSize: 14),
                        ),
                      ),
                      if (!isRead)
                        Container(
                          width: 8, height: 8,
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.gold),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(n['body'] as String? ?? '',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                  const SizedBox(height: 4),
                  Text(
                    timeAgo(n['created_at'] as String? ?? ''),
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
