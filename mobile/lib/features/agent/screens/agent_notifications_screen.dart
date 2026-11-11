import 'package:flutter/material.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';

class AgentNotificationsScreen extends StatefulWidget {
  const AgentNotificationsScreen({super.key});

  @override
  State<AgentNotificationsScreen> createState() => _AgentNotificationsScreenState();
}

class _AgentNotificationsScreenState extends State<AgentNotificationsScreen> {
  final _api = AgentApiService();
  List<AgentNotificationItem> _notifications = [];
  bool _isLoading = true;
  String _selectedCategory = 'all';
  Map<String, int> _byCategoryCounts = {
    'all': 0,
    'commission': 0,
    'payout': 0,
    'transfer': 0,
    'system': 0,
  };

  final List<Map<String, String>> _categories = [
    {'id': 'all', 'label': 'All', 'icon': '🔔'},
    {'id': 'commission', 'label': 'Commissions', 'icon': '💰'},
    {'id': 'payout', 'label': 'Payouts', 'icon': '🏦'},
    {'id': 'transfer', 'label': 'Transfers', 'icon': '⚡'},
    {'id': 'system', 'label': 'System', 'icon': '🛡️'},
  ];

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    setState(() => _isLoading = true);
    try {
      final res = await _api.getNotifications(category: _selectedCategory);
      if (mounted) {
        setState(() {
          _notifications = res['notifications'] as List<AgentNotificationItem>;
          _byCategoryCounts = {
            'all': res['unread_count'] as int? ?? 0,
            ...(res['by_category'] as Map<String, int>? ?? {}),
          };
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _markAllRead() async {
    await _api.markNotificationsRead(category: _selectedCategory);
    _loadNotifications();
  }

  Future<void> _clearAll() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.cardBg,
        title: const Text('Clear all alerts?', style: TextStyle(color: Colors.white)),
        content: const Text(
          'This will clear your notifications feed.',
          style: TextStyle(color: AgentTheme.textMuted),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel', style: TextStyle(color: AgentTheme.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Clear All', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _api.clearNotifications();
    _loadNotifications();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Agent Alerts & Activity'),
        actions: [
          if (_notifications.isNotEmpty)
            TextButton(
              onPressed: _markAllRead,
              child: const Text('Mark Read', style: TextStyle(color: AgentTheme.goldLight)),
            ),
          if (_notifications.isNotEmpty)
            IconButton(
              onPressed: _clearAll,
              tooltip: 'Clear all',
              icon: const Icon(Icons.delete_sweep_rounded, color: AgentTheme.textMuted, size: 22),
            ),
        ],
      ),
      body: Column(
        children: [
          // Filter Tabs Bar
          Container(
            height: 48,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              color: AgentTheme.cardBg.withOpacity(0.4),
              border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.06), width: 0.5)),
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
                      _isLoading = true;
                    });
                    _loadNotifications();
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                    decoration: BoxDecoration(
                      color: isSelected ? AgentTheme.gold.withOpacity(0.2) : AgentTheme.surface,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: isSelected ? AgentTheme.gold : Colors.white.withOpacity(0.1),
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
                            color: isSelected ? AgentTheme.gold : Colors.white,
                          ),
                        ),
                        if (count > 0) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: isSelected ? AgentTheme.gold : Colors.redAccent,
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

          // Notification List
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: AgentTheme.gold))
                : _notifications.isEmpty
                    ? Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.notifications_none, color: AgentTheme.textMuted.withOpacity(0.4), size: 56),
                            const SizedBox(height: 12),
                            const Text('No alerts in this category', style: TextStyle(color: AgentTheme.textMuted)),
                          ],
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadNotifications,
                        color: AgentTheme.gold,
                        backgroundColor: AgentTheme.cardBg,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _notifications.length,
                          itemBuilder: (ctx, i) {
                            final n = _notifications[i];
                            IconData icon = Icons.notifications;
                            Color iconColor = AgentTheme.gold;

                            if (n.type == 'transfer') {
                              icon = Icons.flash_on;
                              iconColor = AgentTheme.emerald;
                            } else if (n.type == 'payout') {
                              icon = Icons.account_balance_wallet;
                              iconColor = Colors.orangeAccent;
                            } else if (n.type == 'commission') {
                              icon = Icons.monetization_on;
                              iconColor = AgentTheme.gold;
                            }

                            return Container(
                              margin: const EdgeInsets.only(bottom: 12),
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: n.isRead ? AgentTheme.cardBg : AgentTheme.surface,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: n.isRead ? Colors.white.withOpacity(0.06) : AgentTheme.gold.withOpacity(0.3),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(10),
                                    decoration: BoxDecoration(
                                      color: iconColor.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Icon(icon, color: iconColor, size: 22),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                n.title,
                                                style: TextStyle(
                                                  color: Colors.white,
                                                  fontWeight: n.isRead ? FontWeight.normal : FontWeight.bold,
                                                  fontSize: 14,
                                                ),
                                              ),
                                            ),
                                            if (!n.isRead)
                                              Container(
                                                width: 8,
                                                height: 8,
                                                margin: const EdgeInsets.only(left: 8),
                                                decoration: const BoxDecoration(
                                                  color: AgentTheme.gold,
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          n.body,
                                          style: const TextStyle(color: AgentTheme.textMuted, fontSize: 13),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          n.createdAt != null
                                              ? '${n.createdAt!.hour.toString().padLeft(2, '0')}:${n.createdAt!.minute.toString().padLeft(2, '0')}'
                                              : 'Just now',
                                          style: TextStyle(color: AgentTheme.textMuted.withOpacity(0.6), fontSize: 11),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}
