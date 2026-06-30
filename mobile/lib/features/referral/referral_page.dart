import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

class ReferralPage extends StatefulWidget {
  const ReferralPage({super.key});
  @override
  State<ReferralPage> createState() => _ReferralPageState();
}

class _ReferralPageState extends State<ReferralPage> with SingleTickerProviderStateMixin {
  bool _loading = true;
  bool _hasError = false;
  Map<String, dynamic>? _data;

  late final AnimationController _shimmerCtrl;

  @override
  void initState() {
    super.initState();
    _shimmerCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1500))..repeat();
    _load();
  }

  @override
  void dispose() { _shimmerCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    setState(() { _loading = true; _hasError = false; });
    try {
      final res = await ApiClient().dio.get('/api/referrals/my-stats');
      if (!mounted) return;
      setState(() { _data = res.data; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _hasError = true; });
    }
  }

  String get _code => _data?['referral_code'] ?? '';
  String get _link => _data?['referral_link'] ?? '';
  Map<String, dynamic> get _stats => (_data?['stats'] as Map?)?.cast<String, dynamic>() ?? {};
  List<dynamic> get _referrals => (_data?['referrals'] as List?) ?? [];

  void _copyCode() {
    Clipboard.setData(ClipboardData(text: _code));
    AppSnackBar.show(context, '✅ Code copied!', success: true);
  }

  void _copyLink() {
    Clipboard.setData(ClipboardData(text: _link));
    AppSnackBar.show(context, '✅ Link copied!', success: true);
  }

  void _share() {
    Share.share(
      '🎮 Join MyOnlineJoker & get ₹50 bonus!\n'
      'Use my referral code: $_code\n'
      'Download & register: $_link',
      subject: 'Play & Win with MyOnlineJoker!',
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Refer & Earn'),
        backgroundColor: AppColors.surface,
        leading: const BackButton(color: AppColors.gold),
        actions: [
          if (!_loading && !_hasError)
            IconButton(
              icon: const Icon(Icons.refresh_rounded, color: AppColors.gold),
              onPressed: _load,
            ),
        ],
      ),
      body: _loading
          ? _buildShimmer()
          : _hasError
              ? _buildError()
              : RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.gold,
                  backgroundColor: AppColors.surface,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
                    children: [
                      _buildHeroCard(),
                      const SizedBox(height: 16),
                      _buildReferralLink(),
                      const SizedBox(height: 20),
                      _buildStatsRow(),
                      const SizedBox(height: 24),
                      _buildHowItWorks(),
                      const SizedBox(height: 24),
                      _buildReferralsList(),
                    ],
                  ),
                ),
    );
  }

  // ── Hero Card ────────────────────────────────────────────────────────────────

  Widget _buildHeroCard() => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [Color(0xFF1C1455), Color(0xFF0B1E52), Color(0xFF0D1117)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: AppColors.gold.withOpacity(0.3), width: 1.5),
      boxShadow: [
        BoxShadow(color: AppColors.gold.withOpacity(0.15), blurRadius: 24, offset: const Offset(0, 8)),
      ],
    ),
    child: Stack(
      children: [
        // Decorative circles
        Positioned(right: -16, top: -16, child: Container(
          width: 100, height: 100,
          decoration: BoxDecoration(shape: BoxShape.circle, color: AppColors.gold.withOpacity(0.05)),
        )),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Text('🎁', style: TextStyle(fontSize: 28)),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Invite & Earn',
                        style: TextStyle(color: Colors.white70, fontSize: 13)),
                      const Text('₹50 per Friend!',
                        style: TextStyle(
                          color: AppColors.gold, fontSize: 22,
                          fontWeight: FontWeight.w900, letterSpacing: 0.5,
                        )),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Text('YOUR REFERRAL CODE',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 11, letterSpacing: 1.5)),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.gold.withOpacity(0.4), width: 2),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(_code,
                    style: const TextStyle(
                      color: AppColors.gold,
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 4,
                    )),
                  GestureDetector(
                    onTap: _copyCode,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.gold.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: AppColors.gold.withOpacity(0.4)),
                      ),
                      child: const Icon(Icons.copy_rounded, color: AppColors.gold, size: 18),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: GestureDetector(
                    onTap: _copyLink,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: AppColors.gold.withOpacity(0.35)),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.link_rounded, color: AppColors.gold, size: 18),
                          SizedBox(width: 6),
                          Text('Copy Link', style: TextStyle(
                            color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: GestureDetector(
                    onTap: _share,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(
                        color: AppColors.gold,
                        borderRadius: BorderRadius.circular(14),
                        boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4), blurRadius: 12)],
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.share_rounded, color: Colors.black, size: 18),
                          SizedBox(width: 6),
                          Text('Share Now', style: TextStyle(
                            color: Colors.black, fontWeight: FontWeight.w900, fontSize: 13)),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  );

  // ── Referral Link Row ────────────────────────────────────────────────────────

  Widget _buildReferralLink() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: AppColors.border),
    ),
    child: Row(
      children: [
        const Icon(Icons.link_rounded, color: AppColors.textSecondary, size: 16),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            _link.replaceFirst('https://', ''),
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 8),
        GestureDetector(
          onTap: _copyLink,
          child: const Text('COPY', style: TextStyle(
            color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.w900, letterSpacing: 1)),
        ),
      ],
    ),
  );

  // ── Stats Row ────────────────────────────────────────────────────────────────

  Widget _buildStatsRow() => Row(
    children: [
      Expanded(child: _statCard('👥', 'Friends\nJoined',
        '${_stats['total_referred'] ?? 0}',
        const Color(0xFF1E3A8A), AppColors.blue)),
      const SizedBox(width: 10),
      Expanded(child: _statCard('💰', 'Total\nEarned',
        formatCurrency(_stats['total_earned'] ?? 0),
        const Color(0xFF1A4C2E), AppColors.green)),
      const SizedBox(width: 10),
      Expanded(child: _statCard('⏳', 'Pending\nRewards',
        '${_stats['pending_count'] ?? 0}',
        const Color(0xFF4A2A00), AppColors.orange)),
    ],
  );

  Widget _statCard(String emoji, String label, String value, Color bgColor, Color accent) =>
    Container(
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
      decoration: BoxDecoration(
        color: bgColor.withOpacity(0.4),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 22)),
          const SizedBox(height: 6),
          Text(value,
            style: TextStyle(color: accent, fontSize: 16, fontWeight: FontWeight.w900)),
          const SizedBox(height: 2),
          Text(label, textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, height: 1.3)),
        ],
      ),
    );

  // ── How It Works ─────────────────────────────────────────────────────────────

  Widget _buildHowItWorks() => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('How It Works', style: TextStyle(
          fontSize: 16, fontWeight: FontWeight.w900, color: Colors.white)),
        const SizedBox(height: 16),
        _step('1', Icons.share_rounded, 'Share Your Code',
          'Send your referral code or link to friends', AppColors.blue),
        _stepConnector(),
        _step('2', Icons.person_add_rounded, 'Friend Registers',
          'Friend signs up using your code & downloads the app', AppColors.purple),
        _stepConnector(),
        _step('3', Icons.account_balance_wallet_rounded, 'Friend Deposits',
          'Friend makes their first deposit', AppColors.orange),
        _stepConnector(),
        _step('4', Icons.emoji_events_rounded, 'You Earn ₹50',
          'Bonus is instantly credited to your real balance!', AppColors.green),
      ],
    ),
  );

  Widget _step(String num, IconData icon, String title, String sub, Color color) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Container(
        width: 36, height: 36,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: color.withOpacity(0.15),
          border: Border.all(color: color.withOpacity(0.5)),
        ),
        child: Center(child: Text(num,
          style: TextStyle(color: color, fontWeight: FontWeight.w900, fontSize: 14))),
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
            const SizedBox(height: 2),
            Text(sub, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12, height: 1.4)),
          ],
        ),
      ),
    ],
  );

  Widget _stepConnector() => Padding(
    padding: const EdgeInsets.only(left: 18, top: 4, bottom: 4),
    child: Container(width: 2, height: 16, color: AppColors.border),
  );

  // ── Referrals List ───────────────────────────────────────────────────────────

  Widget _buildReferralsList() {
    final count = _referrals.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('Your Referrals',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.gold.withOpacity(0.15),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withOpacity(0.4)),
              ),
              child: Text('$count', style: const TextStyle(
                color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (count == 0)
          _buildEmptyReferrals()
        else
          ...List.generate(count, (i) => _buildReferralTile(_referrals[i] as Map<String, dynamic>)),
      ],
    );
  }

  Widget _buildEmptyReferrals() => Container(
    padding: const EdgeInsets.symmetric(vertical: 40),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(
      children: [
        const Text('👥', style: TextStyle(fontSize: 48)),
        const SizedBox(height: 12),
        const Text('No referrals yet',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const SizedBox(height: 6),
        const Text('Share your code and start earning!',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 20),
        GestureDetector(
          onTap: _share,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
            decoration: BoxDecoration(
              color: AppColors.gold,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.share_rounded, color: Colors.black, size: 18),
                SizedBox(width: 8),
                Text('Share Now', style: TextStyle(
                  color: Colors.black, fontWeight: FontWeight.w900, fontSize: 14)),
              ],
            ),
          ),
        ),
      ],
    ),
  );

  Widget _buildReferralTile(Map<String, dynamic> r) {
    final status = r['status'] as String? ?? 'pending';
    final username = r['username'] as String? ?? 'Unknown';
    final reward = double.tryParse(r['reward_amount']?.toString() ?? '0') ?? 0;
    final createdAt = r['created_at'] != null ? DateTime.tryParse(r['created_at']) : null;
    final initials = username.isNotEmpty ? username[0].toUpperCase() : '?';

    final (statusLabel, statusColor, statusIcon) = switch (status) {
      'rewarded'  => ('Rewarded', AppColors.green, Icons.check_circle_rounded),
      'qualified' => ('Deposited', AppColors.blue, Icons.verified_rounded),
      _           => ('Pending', AppColors.orange, Icons.schedule_rounded),
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          // Avatar
          Container(
            width: 44, height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: statusColor.withOpacity(0.15),
              border: Border.all(color: statusColor.withOpacity(0.4)),
            ),
            child: Center(child: Text(initials,
              style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 16))),
          ),
          const SizedBox(width: 12),
          // Info
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(username,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Icon(Icons.calendar_today_rounded, color: AppColors.textSecondary, size: 11),
                    const SizedBox(width: 4),
                    Text(
                      createdAt != null
                        ? '${createdAt.day}/${createdAt.month}/${createdAt.year}'
                        : '—',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    ),
                  ],
                ),
              ],
            ),
          ),
          // Status + reward
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: statusColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: statusColor.withOpacity(0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(statusIcon, color: statusColor, size: 11),
                    const SizedBox(width: 4),
                    Text(statusLabel, style: TextStyle(
                      color: statusColor, fontSize: 10, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
              if (status == 'rewarded') ...[
                const SizedBox(height: 4),
                Text('+${formatCurrency(reward)}',
                  style: const TextStyle(
                    color: AppColors.green, fontSize: 13, fontWeight: FontWeight.w900)),
              ],
            ],
          ),
        ],
      ),
    );
  }

  // ── Loading / Error states ───────────────────────────────────────────────────

  Widget _buildShimmer() => Shimmer.fromColors(
    baseColor: AppColors.surface,
    highlightColor: AppColors.cardBg,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(height: 260, decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(24))),
          const SizedBox(height: 16),
          Container(height: 48, decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(14))),
          const SizedBox(height: 16),
          Row(children: List.generate(3, (i) => Expanded(child: Container(
            margin: EdgeInsets.only(left: i > 0 ? 10 : 0),
            height: 90,
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(16)),
          )))),
          const SizedBox(height: 16),
          Container(height: 200, decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(20))),
        ],
      ),
    ),
  );

  Widget _buildError() => Center(
    child: Padding(
      padding: const EdgeInsets.all(40),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('😕', style: TextStyle(fontSize: 48)),
          const SizedBox(height: 16),
          const Text('Could not load referral data',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _load, child: const Text('Retry')),
        ],
      ),
    ),
  );
}
