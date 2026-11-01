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

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    setState(() => _isLoading = true);
    try {
      final res = await _api.getNotifications();
      if (mounted) {
        setState(() {
          _notifications = res['notifications'] as List<AgentNotificationItem>;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _markAllRead() async {
    await _api.markNotificationsRead();
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
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AgentTheme.gold))
          : _notifications.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.notifications_none, color: AgentTheme.textMuted.withOpacity(0.4), size: 56),
                      const SizedBox(height: 12),
                      const Text('No new alerts', style: TextStyle(color: AgentTheme.textMuted)),
                    ],
                  ),
                )
              : ListView.builder(
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
                                    Text(
                                      n.title,
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontWeight: n.isRead ? FontWeight.normal : FontWeight.bold,
                                        fontSize: 14,
                                      ),
                                    ),
                                    if (!n.isRead)
                                      Container(
                                        width: 8,
                                        height: 8,
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
    );
  }
}

