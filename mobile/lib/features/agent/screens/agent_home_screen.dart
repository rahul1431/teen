import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';
import 'agent_login_screen.dart';
import 'agent_topup_screen.dart';
import 'agent_players_screen.dart';
import 'agent_network_screen.dart';
import 'agent_payouts_screen.dart';
import 'agent_notifications_screen.dart';
import 'agent_analytics_screen.dart';
import 'agent_support_screen.dart';
import 'agent_profile_screen.dart';

class AgentHomeScreen extends StatefulWidget {
  const AgentHomeScreen({super.key});

  @override
  State<AgentHomeScreen> createState() => _AgentHomeScreenState();
}

class _AgentHomeScreenState extends State<AgentHomeScreen> {
  final _api = AgentApiService();
  int _currentIndex = 0;
  AgentProfile? _profile;
  LiveCommissionSummary? _commission;
  int _unreadNotifications = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadDashboardData();
  }

  Future<void> _loadDashboardData() async {
    setState(() => _isLoading = true);
    try {
      final results = await Future.wait([
        _api.getProfile(),
        _api.getLiveCommission(),
        _api.getNotifications(),
      ]);
      if (mounted) {
        setState(() {
          _profile = results[0] as AgentProfile;
          _commission = results[1] as LiveCommissionSummary;
          _unreadNotifications = (results[2] as Map<String, dynamic>)['unread_count'] as int? ?? 0;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: ${e.toString().replaceAll('Exception: ', '')}')),
        );
      }
    }
  }

  void _shareReferralLink() {
    if (_profile == null) return;
    final url = 'https://game.myonlinejoker.com/?ref=${_profile!.referralCode}';
    final text = '🃏 Play real-money Teen Patti, Rummy, and Ludo on MyOnlineJoker!\n\n'
        '🎁 Claim ₹500 Welcome Bonus with my VIP Invite:\n'
        '$url\n\n'
        'Use Agent Referral Code: ${_profile!.referralCode}';
    Share.share(text, subject: 'MyOnlineJoker VIP Invite');
  }

  void _shareViaWhatsApp() async {
    if (_profile == null) return;
    final url = 'https://game.myonlinejoker.com/?ref=${_profile!.referralCode}';
    final msg = Uri.encodeComponent(
      '🃏 *MyOnlineJoker VIP Invitation*\n\n'
      'Join India\'s premier gaming platform! Instant UPI cashouts & ₹500 welcome bonus.\n\n'
      '👉 Play Now: $url\n'
      '🔑 Use Referral Code: *${_profile!.referralCode}*',
    );
    final waUri = Uri.parse('whatsapp://send?text=$msg');
    if (await canLaunchUrl(waUri)) {
      await launchUrl(waUri);
    } else {
      _shareReferralLink();
    }
  }

  void _showQrCodeModal() {
    if (_profile == null) return;
    final refUrl = 'https://game.myonlinejoker.com/?ref=${_profile!.referralCode}';

    showModalBottomSheet(
      context: context,
      backgroundColor: AgentTheme.cardBg,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) {
        return Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'YOUR AGENT QR CODE',
                style: TextStyle(
                  color: AgentTheme.gold,
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Players can scan to register under your code: ${_profile!.referralCode}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: AgentTheme.textMuted, fontSize: 13),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: QrImageView(
                  data: refUrl,
                  version: QrVersions.auto,
                  size: 200.0,
                  backgroundColor: Colors.white,
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: refUrl));
                        Navigator.pop(context);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Referral link copied to clipboard!')),
                        );
                      },
                      icon: const Icon(Icons.copy, color: AgentTheme.gold),
                      label: const Text('Copy Link', style: TextStyle(color: AgentTheme.gold)),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: AgentTheme.gold.withOpacity(0.5)),
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                        _shareViaWhatsApp();
                      },
                      icon: const Icon(Icons.share, color: Colors.black),
                      label: const Text('WhatsApp', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AgentTheme.gold,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  void _handleLogout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AgentTheme.cardBg,
        title: const Text('Log Out?', style: TextStyle(color: Colors.white)),
        content: const Text('Are you sure you want to sign out of the Agent Portal?', style: TextStyle(color: AgentTheme.textMuted)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.crimson),
            child: const Text('Sign Out', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      await _api.clearToken();
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const AgentLoginScreen()),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        backgroundColor: AgentTheme.background,
        body: Center(
          child: CircularProgressIndicator(color: AgentTheme.gold),
        ),
      );
    }

    final pages = [
      _buildHomeTab(),
      const AgentPlayersScreen(),
      const AgentAnalyticsScreen(),
      AgentNetworkScreen(subAgents: _profile?.subAgents ?? []),
      AgentProfileScreen(
        initialProfile: _profile,
        onProfileUpdated: _loadDashboardData,
      ),
    ];

    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                gradient: AgentTheme.goldGradient,
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'AGENT',
                style: TextStyle(color: Colors.black, fontSize: 11, fontWeight: FontWeight.w900),
              ),
            ),
            const SizedBox(width: 8),
            Text(_profile?.displayName ?? 'Partner Portal'),
          ],
        ),
        actions: [
          IconButton(
            icon: Stack(
              children: [
                const Icon(Icons.notifications_outlined, color: AgentTheme.gold, size: 26),
                if (_unreadNotifications > 0)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: const BoxDecoration(
                        color: AgentTheme.crimson,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '$_unreadNotifications',
                        style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
              ],
            ),
            onPressed: () async {
              await Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AgentNotificationsScreen()),
              );
              _loadDashboardData();
            },
          ),
          IconButton(
            icon: const Icon(Icons.support_agent, color: AgentTheme.gold, size: 26),
            tooltip: 'Support Desk',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => AgentSupportScreen(profile: _profile)),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.person_outline, color: AgentTheme.gold, size: 26),
            tooltip: 'Profile & Settings',
            onPressed: () => setState(() => _currentIndex = 4),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadDashboardData,
        color: AgentTheme.gold,
        backgroundColor: AgentTheme.cardBg,
        child: pages[_currentIndex],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
        backgroundColor: AgentTheme.surface,
        indicatorColor: AgentTheme.gold.withOpacity(0.25),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.dashboard_outlined, color: AgentTheme.textMuted),
            selectedIcon: Icon(Icons.dashboard, color: AgentTheme.gold),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.people_outline, color: AgentTheme.textMuted),
            selectedIcon: Icon(Icons.people, color: AgentTheme.gold),
            label: 'Players',
          ),
          NavigationDestination(
            icon: Icon(Icons.insights_outlined, color: AgentTheme.textMuted),
            selectedIcon: Icon(Icons.insights, color: AgentTheme.gold),
            label: 'Analytics',
          ),
          NavigationDestination(
            icon: Icon(Icons.account_tree_outlined, color: AgentTheme.textMuted),
            selectedIcon: Icon(Icons.account_tree, color: AgentTheme.gold),
            label: 'Network',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline, color: AgentTheme.textMuted),
            selectedIcon: Icon(Icons.person, color: AgentTheme.gold),
            label: 'Profile',
          ),
        ],
      ),
    );
  }

  Widget _buildHomeTab() {
    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. Balance Card
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: AgentTheme.cardGradient,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AgentTheme.gold.withOpacity(0.35)),
              boxShadow: [
                BoxShadow(
                  color: AgentTheme.gold.withOpacity(0.08),
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'AVAILABLE BALANCE',
                      style: TextStyle(
                        color: AgentTheme.goldLight,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        letterSpacing: 1.0,
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.06),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        'Code: ${_profile?.referralCode ?? ""}',
                        style: const TextStyle(
                          color: AgentTheme.gold,
                          fontSize: 12,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  '₹${(_profile?.balance ?? 0).toStringAsFixed(2)}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 34,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 16),
                const Divider(color: Colors.white12),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Total Earned', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                          const SizedBox(height: 2),
                          Text(
                            '₹${(_profile?.totalEarned ?? 0).toStringAsFixed(0)}',
                            style: const TextStyle(color: AgentTheme.emerald, fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Paid Out', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                          const SizedBox(height: 2),
                          Text(
                            '₹${(_profile?.totalPaidOut ?? 0).toStringAsFixed(0)}',
                            style: const TextStyle(color: Colors.white70, fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Total Players', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                          const SizedBox(height: 2),
                          Text(
                            '${_profile?.playerCount ?? 0}',
                            style: const TextStyle(color: AgentTheme.goldLight, fontSize: 16, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // 2. Quick Actions Grid
          const Text(
            'QUICK OPERATIONS',
            style: TextStyle(color: AgentTheme.gold, fontSize: 13, fontWeight: FontWeight.bold, letterSpacing: 0.8),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              // Direct Chip Top-Up Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.flash_on,
                  title: 'Top Up Player',
                  subtitle: 'Direct Chip Transfer',
                  color: AgentTheme.emerald,
                  onTap: () async {
                    final res = await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => AgentTopUpScreen(currentBalance: _profile?.balance ?? 0),
                      ),
                    );
                    if (res == true) _loadDashboardData();
                  },
                ),
              ),
              const SizedBox(width: 12),
              // Share Link Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.share,
                  title: 'Share Invite',
                  subtitle: 'WhatsApp & Telegram',
                  color: AgentTheme.gold,
                  onTap: _shareViaWhatsApp,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              // QR Code Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.qr_code_2,
                  title: 'Agent QR Code',
                  subtitle: 'Scan in Person',
                  color: Colors.lightBlueAccent,
                  onTap: _showQrCodeModal,
                ),
              ),
              const SizedBox(width: 12),
              // Request Payout Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.account_balance,
                  title: 'Withdraw Payout',
                  subtitle: 'UPI & Bank Transfer',
                  color: Colors.orangeAccent,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const AgentPayoutsScreen()),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              // Link Analytics Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.insights,
                  title: 'Funnel Analytics',
                  subtitle: 'Clicks, FTDs & Sources',
                  color: Colors.purpleAccent,
                  onTap: () => setState(() => _currentIndex = 2),
                ),
              ),
              const SizedBox(width: 12),
              // Support Helpdesk Button
              Expanded(
                child: _buildActionCard(
                  icon: Icons.support_agent,
                  title: 'Admin Support',
                  subtitle: 'WhatsApp & Tickets',
                  color: const Color(0xFF25D366),
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => AgentSupportScreen(profile: _profile)),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),

          // 3. Live Daily Commission
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AgentTheme.cardBg,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: Colors.white.withOpacity(0.08)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'TODAY\'S COMMISSION (LIVE)',
                      style: TextStyle(color: AgentTheme.gold, fontSize: 13, fontWeight: FontWeight.bold),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AgentTheme.emerald.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('Real-Time', style: TextStyle(color: AgentTheme.emerald, fontSize: 11, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      '₹${(_commission?.totalCommission ?? 0).toStringAsFixed(2)}',
                      style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900),
                    ),
                    Text(
                      'Direct: ₹${(_commission?.directCommission ?? 0).toStringAsFixed(2)} | Override: ₹${(_commission?.overrideCommission ?? 0).toStringAsFixed(2)}',
                      style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // 4. Sub-Agent Network Snapshot
          if ((_profile?.subAgents.length ?? 0) > 0) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'YOUR SUB-AGENTS',
                  style: TextStyle(color: AgentTheme.gold, fontSize: 13, fontWeight: FontWeight.bold),
                ),
                TextButton(
                  onPressed: () => setState(() => _currentIndex = 2),
                  child: const Text('View All', style: TextStyle(color: AgentTheme.goldLight)),
                ),
              ],
            ),
            ...(_profile!.subAgents.take(3).map((sub) => Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AgentTheme.surface,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(sub.displayName, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          const SizedBox(height: 2),
                          Text('${sub.playerCount} players · ${sub.commissionRate}% rate', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                        ],
                      ),
                      Text(
                        '₹${sub.totalEarned.toStringAsFixed(0)}',
                        style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ))),
          ],
        ],
      ),
    );
  }

  Widget _buildActionCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        decoration: BoxDecoration(
          color: AgentTheme.cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.08)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              style: const TextStyle(color: AgentTheme.textMuted, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}

