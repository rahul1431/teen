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

  IconData _icon(String type) {
    switch (type) {
      case 'win': return Icons.emoji_events;
      case 'deposit': return Icons.account_balance_wallet;
      case 'withdrawal': return Icons.payment;
      case 'kyc': return Icons.verified_user;
      case 'bonus': return Icons.card_giftcard;
      case 'broadcast': return Icons.campaign;
      default: return Icons.notifications;
    }
  }

  Color _iconColor(String type) {
    switch (type) {
      case 'win': return AppColors.gold;
      case 'deposit': return AppColors.green;
      case 'withdrawal': return Colors.orange;
      case 'kyc': return Colors.blue;
      case 'bonus': return AppColors.gold;
      case 'broadcast': return Colors.purple;
      default: return AppColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (_notifications.any((n) => n['read'] == false))
            TextButton(
              onPressed: () async {
                for (int i = 0; i < _notifications.length; i++) {
                  if (_notifications[i]['read'] == false) {
                    await _markRead(_notifications[i]['id'] as String, i);
                  }
                }
              },
              child: const Text('Mark all read', style: TextStyle(color: AppColors.gold)),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.notifications_none, size: 64, color: AppColors.textSecondary),
                      const SizedBox(height: 12),
                      const Text('No notifications yet', style: TextStyle(color: AppColors.textSecondary)),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    itemCount: _notifications.length,
                    separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                    itemBuilder: (context, i) {
                      final n = _notifications[i];
                      final isRead = n['read'] == true;
                      return InkWell(
                        onTap: () => _markRead(n['id'] as String, i),
                        child: Container(
                          color: isRead ? Colors.transparent : AppColors.gold.withOpacity(0.06),
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                width: 40, height: 40,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _iconColor(n['type'] as String? ?? '').withOpacity(0.15),
                                ),
                                child: Icon(_icon(n['type'] as String? ?? ''),
                                    color: _iconColor(n['type'] as String? ?? ''), size: 20),
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
                                            style: TextStyle(
                                              fontWeight: isRead ? FontWeight.normal : FontWeight.bold,
                                              fontSize: 14,
                                            ),
                                          ),
                                        ),
                                        if (!isRead)
                                          Container(
                                            width: 8, height: 8,
                                            decoration: const BoxDecoration(
                                                shape: BoxShape.circle, color: AppColors.gold),
                                          ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(n['body'] as String? ?? '',
                                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                                    const SizedBox(height: 4),
                                    Text(
                                      _timeAgo(n['created_at'] as String? ?? ''),
                                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  String _timeAgo(String isoDate) {
    try {
      final dt = DateTime.parse(isoDate).toLocal();
      final diff = DateTime.now().difference(dt);
      if (diff.inMinutes < 1) return 'just now';
      if (diff.inHours < 1) return '${diff.inMinutes}m ago';
      if (diff.inDays < 1) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }
}
