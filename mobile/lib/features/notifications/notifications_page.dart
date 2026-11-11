import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/network/api_client.dart';
import '../../core/services/notification_service.dart';
import '../../shared/theme/app_theme.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});
  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  List<dynamic> _notifications = [];
  bool _loading = true;
  String _selectedCategory = 'all';
  Map<String, int> _byCategoryCounts = {
    'all': 0,
    'promotions': 0,
    'cashier': 0,
    'game_alerts': 0,
    'system': 0,
  };

  final List<Map<String, String>> _categories = [
    {'id': 'all', 'label': 'All', 'icon': '🔔'},
    {'id': 'promotions', 'label': 'Promotions', 'icon': '🎁'},
    {'id': 'cashier', 'label': 'Wallet & Cashier', 'icon': '💰'},
    {'id': 'game_alerts', 'label': 'Game Alerts', 'icon': '🎮'},
    {'id': 'system', 'label': 'System', 'icon': '🛡️'},
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final query = <String, dynamic>{'limit': 50};
      if (_selectedCategory != 'all') {
        query['category'] = _selectedCategory;
      }

      final results = await Future.wait([
        ApiClient().dio.get('/api/notifications/me', queryParameters: query),
        ApiClient().dio.get('/api/notifications/unread-count'),
      ]);

      final notifRes = results[0];
      final unreadRes = results[1];

      if (mounted) {
        final countData = unreadRes.data['by_category'] as Map<String, dynamic>? ?? {};
        setState(() {
          _notifications = notifRes.data as List;
          _byCategoryCounts = {
            'all': int.tryParse(unreadRes.data['count']?.toString() ?? '0') ?? 0,
            'promotions': int.tryParse(countData['promotions']?.toString() ?? '0') ?? 0,
            'cashier': int.tryParse(countData['cashier']?.toString() ?? '0') ?? 0,
            'game_alerts': int.tryParse(countData['game_alerts']?.toString() ?? '0') ?? 0,
            'system': int.tryParse(countData['system']?.toString() ?? '0') ?? 0,
          };
          _loading = false;
        });
      }
      NotificationService.instance.refresh();
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markRead(String id, int index) async {
    try {
      await ApiClient().dio.put('/api/notifications/read/$id');
      if (mounted) {
        setState(() {
          _notifications[index] = {
            ...Map<String, dynamic>.from(_notifications[index]),
            'read': true
          };
        });
      }
      NotificationService.instance.refresh();
    } catch (_) {}
  }

  Future<void> _markAllRead() async {
    try {
      final query = _selectedCategory != 'all' ? {'category': _selectedCategory} : null;
      await ApiClient().dio.put('/api/notifications/read-all', queryParameters: query);
      if (mounted) {
        setState(() {
          _notifications = _notifications
              .map((n) => {...Map<String, dynamic>.from(n), 'read': true})
              .toList();
          if (_selectedCategory == 'all') {
            _byCategoryCounts = _byCategoryCounts.map((k, v) => MapEntry(k, 0));
          } else {
            _byCategoryCounts[_selectedCategory] = 0;
            _byCategoryCounts['all'] = _byCategoryCounts.values.fold(0, (a, b) => a + b);
          }
        });
      }
      NotificationService.instance.refresh();
    } catch (_) {}
  }

  Future<void> _deleteNotification(String id, int index) async {
    try {
      await ApiClient().dio.delete('/api/notifications/$id');
      if (mounted) {
        setState(() {
          _notifications.removeAt(index);
        });
      }
      NotificationService.instance.refresh();
    } catch (_) {}
  }

  Future<void> _clearAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Clear all notifications?'),
        content: const Text(
          'This will clear notifications from your inbox.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Clear All', style: TextStyle(color: AppColors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ApiClient().dio.delete('/api/notifications/all');
      if (mounted) setState(() => _notifications = []);
      NotificationService.instance.refresh();
    } catch (_) {}
  }

  void _handleAction(String notifId, int index, String? route) {
    if (route == null || route.isEmpty) return;
    _markRead(notifId, index);

    // Track click attribution
    ApiClient().dio.put('/api/notifications/click/$notifId').catchError((_) {});

    if (route.startsWith('http://') || route.startsWith('https://')) {
      // External link or browser handling
      return;
    }

    try {
      context.push(route);
    } catch (_) {
      // Fallback
      if (route.contains('wallet')) {
        context.push('/wallet');
      } else if (route.contains('patti')) {
        context.push('/games/teen-patti');
      } else {
        context.push('/home');
      }
    }
  }

  List<dynamic> _parseActions(dynamic actionsData) {
    if (actionsData == null) return [];
    if (actionsData is List) return actionsData;
    if (actionsData is String && actionsData.isNotEmpty) {
      try {
        return jsonDecode(actionsData) as List<dynamic>;
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  void _openDetail(Map<String, dynamic> n, int i) {
    if (n['read'] != true) _markRead(n['id'] as String, i);
    final type = n['type'] as String? ?? '';
    final color = _iconColor(type);
    final imageUrl = n['image_url'] as String?;
    final actions = _parseActions(n['action_buttons'] ?? n['data']?['actions']);

    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.5,
        maxChildSize: 0.85,
        builder: (_, scrollCtrl) => SingleChildScrollView(
          controller: scrollCtrl,
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              if (imageUrl != null && imageUrl.isNotEmpty) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    imageUrl,
                    width: double.infinity,
                    height: 160,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.15),
                    ),
                    child: Icon(_icon(type), color: color, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      n['title'] as String? ?? '',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                timeAgo(n['created_at'] as String? ?? ''),
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 16),
              Text(
                n['body'] as String? ?? '',
                style: const TextStyle(color: AppColors.textPrimary, fontSize: 14, height: 1.5),
              ),
              if (actions.isNotEmpty) ...[
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  runSpacing: 10,
                  children: actions.map((act) {
                    final title = act['title'] as String? ?? 'Open';
                    final route = act['route'] as String? ?? act['id'] as String?;
                    return ElevatedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        _handleAction(n['id'] as String, i, route);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.gold,
                        foregroundColor: Colors.black,
                        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
                    );
                  }).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  IconData _icon(String type) {
    switch (type) {
      case 'win':
        return Icons.emoji_events_rounded;
      case 'deposit':
      case 'wallet':
      case 'deposit_recovery':
        return Icons.account_balance_wallet_rounded;
      case 'withdrawal':
      case 'payout':
        return Icons.payments_rounded;
      case 'kyc':
        return Icons.verified_user_rounded;
      case 'bonus':
      case 'promotion':
      case 'churn_winback':
        return Icons.card_giftcard_rounded;
      case 'broadcast':
        return Icons.campaign_rounded;
      default:
        return Icons.notifications_rounded;
    }
  }

  Color _iconColor(String type) {
    switch (type) {
      case 'win':
        return AppColors.gold;
      case 'deposit':
      case 'wallet':
      case 'deposit_recovery':
        return AppColors.green;
      case 'withdrawal':
      case 'payout':
        return AppColors.orange;
      case 'kyc':
        return AppColors.blue;
      case 'bonus':
      case 'promotion':
      case 'churn_winback':
        return AppColors.gold;
      case 'broadcast':
        return AppColors.purple;
      default:
        return AppColors.textSecondary;
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
          if (_notifications.isNotEmpty)
            IconButton(
              onPressed: _clearAll,
              tooltip: 'Clear all',
              icon: const Icon(Icons.delete_sweep_rounded, color: AppColors.textSecondary, size: 22),
            ),
        ],
      ),
      body: Column(
        children: [
          // Category Pills Filter Bar
          Container(
            height: 48,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: AppColors.border, width: 0.5)),
            ),
            child: ListView.separated(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              scrollDirection: Axis.horizontal,
              itemCount: _categories.length,
              separatorBuilder: (_, __) => const SizedBox(width: 8),
              itemBuilder: (_, idx) {
                final cat = _categories[idx];
                final id = cat['id']!;
                final isSelected = _selectedCategory == id;
                final count = _byCategoryCounts[id] ?? 0;

                return GestureDetector(
                  onTap: () {
                    setState(() {
                      _selectedCategory = id;
                      _loading = true;
                    });
                    _load();
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: isSelected ? AppColors.gold.withValues(alpha: 0.2) : AppColors.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: isSelected ? AppColors.gold : AppColors.border,
                        width: isSelected ? 1.2 : 0.8,
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(cat['icon']!, style: const TextStyle(fontSize: 12)),
                        const SizedBox(width: 6),
                        Text(
                          cat['label']!,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                            color: isSelected ? AppColors.gold : AppColors.textPrimary,
                          ),
                        ),
                        if (count > 0) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: isSelected ? AppColors.gold : Colors.redAccent,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              '$count',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: isSelected ? Colors.black : Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                );
              },
            ),
          ),

          // Main Notifications List
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
                : _notifications.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.notifications_none_rounded,
                              size: 64,
                              color: AppColors.textSecondary.withValues(alpha: 0.4),
                            ),
                            const SizedBox(height: 12),
                            const Text('No notifications in this tab', style: TextStyle(color: AppColors.textSecondary)),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        color: AppColors.gold,
                        backgroundColor: AppColors.surface,
                        child: ListView.separated(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          itemCount: _notifications.length,
                          separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                          itemBuilder: (_, i) => _buildItem(_notifications[i], i),
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _buildItem(Map<String, dynamic> n, int i) {
    final notifId = n['id'] as String? ?? '';
    final isRead = n['read'] == true;
    final type = n['type'] as String? ?? '';
    final color = _iconColor(type);
    final imageUrl = n['image_url'] as String?;
    final actions = _parseActions(n['action_buttons'] ?? n['data']?['actions']);

    return Dismissible(
      key: Key(notifId.isNotEmpty ? notifId : 'notif_$i'),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        color: Colors.redAccent.withValues(alpha: 0.8),
        child: const Icon(Icons.delete_outline, color: Colors.white, size: 26),
      ),
      onDismissed: (_) {
        _deleteNotification(notifId, i);
      },
      child: InkWell(
        onTap: () => _openDetail(n, i),
        child: Container(
          color: isRead ? Colors.transparent : AppColors.gold.withValues(alpha: 0.05),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.15),
                    ),
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
                                style: TextStyle(
                                  fontWeight: isRead ? FontWeight.normal : FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                            ),
                            if (!isRead)
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(left: 8),
                                decoration: const BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: AppColors.gold,
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          n['body'] as String? ?? '',
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                        ),
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

              // Rich Image Preview Banner (if present)
              if (imageUrl != null && imageUrl.isNotEmpty) ...[
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(
                    imageUrl,
                    width: double.infinity,
                    height: 120,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                  ),
                ),
              ],

              // Inline Action Buttons on Card
              if (actions.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 6,
                  children: actions.map((act) {
                    final title = act['title'] as String? ?? 'Open';
                    final route = act['route'] as String? ?? act['id'] as String?;
                    return InkWell(
                      onTap: () => _handleAction(notifId, i, route),
                      borderRadius: BorderRadius.circular(6),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: AppColors.gold.withValues(alpha: 0.15),
                          border: Border.all(color: AppColors.gold.withValues(alpha: 0.4), width: 0.8),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          title,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: AppColors.goldLight,
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
