import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/network/api_client.dart';
import '../../core/storage/secure_storage.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

// ── Fake live counters (replace with real WebSocket data later) ──────────────
const _kLiveOnline = {'teen-patti': 15842, 'aviator': 9231, 'ludo': 10477, 'cricket': 6120};

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage>
    with TickerProviderStateMixin {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  int _selectedIndex = 0;

  // Data
  Map<String, dynamic>? _user;
  double _realBalance = 0;
  double _bonusBalance = 0;
  bool _loadingData = true;
  bool _hasError = false;

  // Animations
  late final AnimationController _wheelCtrl;
  late final AnimationController _pulseCtrl;
  late final AnimationController _heroCtrl;
  late final Animation<double> _heroFade;
  late final Animation<Offset> _heroSlide;
  late final AnimationController _balanceCtrl;
  late final Animation<double> _balanceFade;

  // Next draw countdown
  DateTime _nextDraw = _nextDrawTime();
  Timer? _ticker;
  Duration _timeToNextDraw = Duration.zero;

  static DateTime _nextDrawTime() {
    final now = DateTime.now();
    final candidate = DateTime(now.year, now.month, now.day, 14, 30);
    return candidate.isBefore(now)
        ? candidate.add(const Duration(days: 1))
        : candidate;
  }

  @override
  void initState() {
    super.initState();
    _wheelCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 8))..repeat();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
    _heroCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
    _heroFade = CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOut);
    _heroSlide = Tween<Offset>(begin: const Offset(0, 0.08), end: Offset.zero)
        .animate(CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOut));
    _balanceCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _balanceFade = CurvedAnimation(parent: _balanceCtrl, curve: Curves.easeIn);

    _updateCountdown();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _updateCountdown());
    _loadData();
  }

  @override
  void dispose() {
    _wheelCtrl.dispose();
    _pulseCtrl.dispose();
    _heroCtrl.dispose();
    _balanceCtrl.dispose();
    _ticker?.cancel();
    super.dispose();
  }

  void _updateCountdown() {
    final diff = _nextDraw.difference(DateTime.now());
    if (diff.isNegative) {
      _nextDraw = _nextDrawTime();
    }
    if (mounted) setState(() => _timeToNextDraw = diff.isNegative ? Duration.zero : diff);
  }

  String get _countdownStr {
    final h = _timeToNextDraw.inHours.toString().padLeft(2, '0');
    final m = (_timeToNextDraw.inMinutes % 60).toString().padLeft(2, '0');
    final s = (_timeToNextDraw.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  Future<void> _loadData() async {
    setState(() { _loadingData = true; _hasError = false; });
    try {
      final [userRes, walletRes] = await Future.wait([
        ApiClient().dio.get('/api/users/me'),
        ApiClient().dio.get('/api/wallet/balance'),
      ]);
      if (!mounted) return;
      setState(() {
        _user = userRes.data;
        _realBalance  = double.tryParse(walletRes.data['real_balance'].toString()) ?? 0;
        _bonusBalance = double.tryParse(walletRes.data['bonus_balance'].toString()) ?? 0;
        _loadingData = false;
      });
      _heroCtrl.forward();
      _balanceCtrl.forward();
    } catch (_) {
      if (mounted) setState(() { _loadingData = false; _hasError = true; });
    }
  }

  String get _initials {
    final name = _user?['username'] as String? ?? '';
    if (name.isEmpty) return 'P';
    final parts = name.trim().split(' ');
    if (parts.length >= 2) return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    return name[0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: AppColors.background,
      drawer: _buildDrawer(),
      body: SafeArea(
        child: Stack(
          children: [
            RefreshIndicator(
              onRefresh: _loadData,
              color: AppColors.gold,
              backgroundColor: AppColors.surface,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(child: _buildHeader()),
                  SliverToBoxAdapter(child: _buildHeroBanner()),
                  SliverToBoxAdapter(child: _buildBalanceSection()),
                  SliverToBoxAdapter(child: _buildPromoStrip()),
                  SliverToBoxAdapter(child: _buildSectionLabel('🎮  Popular Games', trailing: 'See All')),
                  SliverToBoxAdapter(child: _buildMainGamesGrid()),
                  SliverToBoxAdapter(child: _buildSectionLabel('🎲  Luck Games')),
                  SliverToBoxAdapter(child: _buildLuckGamesRow()),
                  const SliverToBoxAdapter(child: SizedBox(height: 120)),
                ],
              ),
            ),
            Positioned(bottom: 16, right: 16, child: _buildSpinWinFab()),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  // ─── Header ─────────────────────────────────────────────────────────────────

  Widget _buildHeader() => Container(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
    child: Row(
      children: [
        GestureDetector(
          onTap: () => _scaffoldKey.currentState?.openDrawer(),
          child: Row(
            children: [
              Container(
                width: 36, height: 36,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const SweepGradient(colors: [
                    AppColors.feltRed, AppColors.gold, Color(0xFF0E5C2F),
                    Color(0xFF1E3A8A), AppColors.gold, AppColors.feltRed,
                  ]),
                  border: Border.all(color: AppColors.gold, width: 1.5),
                ),
                child: const Icon(Icons.adjust_rounded, color: Colors.white, size: 18),
              ),
              const SizedBox(width: 8),
              RichText(
                text: const TextSpan(
                  children: [
                    TextSpan(text: 'TEEN ', style: TextStyle(
                      color: AppColors.gold, fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 1)),
                    TextSpan(text: 'PATTI', style: TextStyle(
                      color: Colors.white, fontSize: 15, fontWeight: FontWeight.w900, letterSpacing: 1)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const Spacer(),
        // Live players badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.green.withOpacity(0.12),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.green.withOpacity(0.4)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              FadeTransition(
                opacity: _pulseCtrl,
                child: Container(width: 6, height: 6,
                    decoration: const BoxDecoration(color: AppColors.green, shape: BoxShape.circle)),
              ),
              const SizedBox(width: 5),
              const Text('41K Online', style: TextStyle(color: AppColors.green, fontSize: 11, fontWeight: FontWeight.bold)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        IconButton(
          icon: Stack(
            children: [
              const Icon(Icons.notifications_outlined, color: AppColors.gold, size: 24),
              Positioned(top: 0, right: 0, child: Container(
                width: 8, height: 8,
                decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle),
              )),
            ],
          ),
          onPressed: () => context.push('/notifications'),
          constraints: const BoxConstraints(),
          padding: const EdgeInsets.all(6),
        ),
        const SizedBox(width: 4),
        GestureDetector(
          onTap: () => context.push('/profile'),
          child: Container(
            padding: const EdgeInsets.all(2),
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(colors: [AppColors.gold, Color(0xFFB8870B)]),
            ),
            child: CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.cardBg,
              child: Text(_initials,
                  style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 14)),
            ),
          ),
        ),
      ],
    ),
  );

  // ─── Hero Banner ─────────────────────────────────────────────────────────────

  Widget _buildHeroBanner() => FadeTransition(
    opacity: _heroFade,
    child: SlideTransition(
      position: _heroSlide,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        height: 140,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: const LinearGradient(
            colors: [Color(0xFF1C1455), Color(0xFF0B1E52), Color(0xFF0D1117)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(color: AppColors.gold.withOpacity(0.25), width: 1.5),
          boxShadow: [
            BoxShadow(color: AppColors.gold.withOpacity(0.12), blurRadius: 24, offset: const Offset(0, 8)),
          ],
        ),
        child: Stack(
          children: [
            // Background decorative circles
            Positioned(right: -20, top: -20, child: Container(
              width: 120, height: 120,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.gold.withOpacity(0.05),
              ),
            )),
            Positioned(right: 40, bottom: -30, child: Container(
              width: 80, height: 80,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.blue.withOpacity(0.08),
              ),
            )),
            // Card suits decoration
            Positioned(
              right: 20, top: 16,
              child: Text('♠ ♥ ♦ ♣',
                style: TextStyle(color: AppColors.gold.withOpacity(0.15), fontSize: 28, letterSpacing: 4)),
            ),
            // Content
            Padding(
              padding: const EdgeInsets.all(22),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text('PLAY & WIN BIG! 🏆',
                    style: TextStyle(
                      color: AppColors.gold,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.5,
                    )),
                  const SizedBox(height: 6),
                  Text('Hey, ${_user?['username'] ?? 'Player'} — your table awaits!',
                    style: const TextStyle(color: Colors.white70, fontSize: 13)),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      _heroBadge('🎯 Daily Bonus', AppColors.green),
                      const SizedBox(width: 8),
                      _heroBadge('🎰 Jackpot ₹10 CR', AppColors.orange),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _heroBadge(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: color.withOpacity(0.15),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: color.withOpacity(0.4)),
    ),
    child: Text(text, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
  );

  // ─── Balance Section ─────────────────────────────────────────────────────────

  Widget _buildBalanceSection() {
    if (_loadingData) return _buildBalanceShimmer();
    if (_hasError) return Padding(
      padding: const EdgeInsets.all(16),
      child: ErrorRetry(message: 'Could not load balance', onRetry: _loadData),
    );
    return FadeTransition(
      opacity: _balanceFade,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF1E2533), Color(0xFF141922)],
            begin: Alignment.topLeft, end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: AppColors.gold.withOpacity(0.3), width: 1.5),
          boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.1), blurRadius: 20, offset: const Offset(0, 4))],
        ),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.account_balance_wallet_rounded, color: AppColors.textSecondary, size: 13),
                          const SizedBox(width: 5),
                          const Text('TOTAL BALANCE',
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 11, letterSpacing: 1.2, fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(formatCurrency(_realBalance),
                        style: const TextStyle(
                          fontSize: 32, fontWeight: FontWeight.w900,
                          color: AppColors.gold,
                          shadows: [Shadow(color: Color(0x66D4AF37), blurRadius: 12)],
                        )),
                    ],
                  ),
                ),
                // Bonus chip
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.orange.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.orange.withOpacity(0.3)),
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.card_giftcard_rounded, color: AppColors.orange, size: 16),
                      const SizedBox(height: 3),
                      Text(formatCurrency(_bonusBalance),
                        style: const TextStyle(color: AppColors.orange, fontSize: 12, fontWeight: FontWeight.bold)),
                      const Text('Bonus', style: TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: _balanceBtn(Icons.add_rounded, 'Add Money', AppColors.gold, Colors.black,
                    () => context.push('/wallet')),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _balanceBtn(Icons.arrow_upward_rounded, 'Withdraw', AppColors.surface, AppColors.gold,
                    () => context.push('/wallet'),
                    border: Border.all(color: AppColors.gold.withOpacity(0.4))),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _balanceBtn(IconData icon, String label, Color bg, Color fg, VoidCallback onTap, {Border? border}) =>
    GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 11),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(14),
          border: border,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: fg, size: 16),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(color: fg, fontWeight: FontWeight.bold, fontSize: 13)),
          ],
        ),
      ),
    );

  Widget _buildBalanceShimmer() => Shimmer.fromColors(
    baseColor: AppColors.surface,
    highlightColor: AppColors.cardBg,
    child: Container(
      margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      height: 130,
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(24)),
    ),
  );

  // ─── Promo Strip ─────────────────────────────────────────────────────────────

  Widget _buildPromoStrip() => SizedBox(
    height: 90,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      children: [
        _promoCard('🎁', 'Daily Login\nBonus', 'Claim ₹100 Now!',
          [const Color(0xFF1A4C2E), const Color(0xFF0D2E19)], AppColors.green,
          onTap: () => _comingSoon('Daily Bonus')),
        _promoCard('🌀', 'Spin &\nWin', 'Try Your Luck!',
          [const Color(0xFF1E1255), const Color(0xFF0B0A33)], AppColors.purple,
          onTap: () => _comingSoon('Spin & Win')),
        _promoCard('👥', 'Refer &\nEarn', 'Get ₹50 Per Ref',
          [const Color(0xFF4A1A00), const Color(0xFF2A0E00)], AppColors.orange,
          onTap: () => context.push('/referral')),
        _promoCard('🏆', 'Leaderboard\nReward', 'Top 3 Win Big',
          [const Color(0xFF4A3200), const Color(0xFF2A1D00)], AppColors.gold,
          onTap: () => context.push('/leaderboard')),
      ],
    ),
  );

  Widget _promoCard(String emoji, String title, String sub,
      List<Color> grad, Color accent, {required VoidCallback onTap}) =>
    GestureDetector(
      onTap: onTap,
      child: Container(
        width: 155,
        margin: const EdgeInsets.only(right: 12),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: grad),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: accent.withOpacity(0.35)),
        ),
        child: Row(
          children: [
            Text(emoji, style: const TextStyle(fontSize: 26)),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(title,
                    style: const TextStyle(color: Colors.white, fontSize: 11.5, fontWeight: FontWeight.w800, height: 1.3)),
                  const SizedBox(height: 2),
                  Text(sub, style: TextStyle(color: accent, fontSize: 10, fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ],
        ),
      ),
    );

  // ─── Section Label ────────────────────────────────────────────────────────────

  Widget _buildSectionLabel(String title, {String? trailing}) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 22, 20, 0),
    child: Row(
      children: [
        Text(title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, letterSpacing: 0.2)),
        const Spacer(),
        if (trailing != null)
          GestureDetector(
            onTap: () {},
            child: Text(trailing,
              style: const TextStyle(color: AppColors.gold, fontSize: 12, fontWeight: FontWeight.bold)),
          ),
      ],
    ),
  );

  // ─── Main Games Grid ──────────────────────────────────────────────────────────

  Widget _buildMainGamesGrid() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    child: Column(
      children: [
        Row(
          children: [
            Expanded(child: _richGameCard(
              title: 'Teen Patti',
              emoji: '🃏',
              subtitle: '${_formatOnline(_kLiveOnline["teen-patti"]!)} Online',
              ctaLabel: 'Play Now',
              gradient: const [Color(0xFFB11226), Color(0xFF7A0C1A), Color(0xFF4A0010)],
              accentColor: const Color(0xFFFF6B6B),
              showAvatars: true,
              route: '/games/teen-patti',
            )),
            const SizedBox(width: 12),
            Expanded(child: _richGameCard(
              title: 'Aviator',
              emoji: '✈️',
              subtitle: 'Real-time Chart',
              ctaLabel: 'Bet Now',
              gradient: const [Color(0xFF1E3A8A), Color(0xFF0B1E52), Color(0xFF060F2E)],
              accentColor: const Color(0xFF60A5FA),
              badge: '7.2x',
              route: '/games/aviator',
            )),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(child: _richGameCard(
              title: 'Ludo',
              emoji: '🎲',
              subtitle: '${_formatOnline(_kLiveOnline["ludo"]!)} Online',
              ctaLabel: 'Start Game',
              gradient: const [Color(0xFF6A1B9A), Color(0xFF3D1165), Color(0xFF1C0735)],
              accentColor: const Color(0xFFCE93D8),
              route: '/games/ludo',
            )),
            const SizedBox(width: 12),
            Expanded(child: _richGameCard(
              title: 'Cricket',
              emoji: '🏏',
              subtitle: '${_formatOnline(_kLiveOnline["cricket"]!)} Online',
              ctaLabel: 'Bet Now',
              gradient: const [Color(0xFF15803D), Color(0xFF0A4521), Color(0xFF062B14)],
              accentColor: const Color(0xFF86EFAC),
              badge: 'LIVE',
              route: '/games/cricket',
            )),
          ],
        ),
      ],
    ),
  );

  String _formatOnline(int n) {
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(0)}K';
    return n.toString();
  }

  Widget _richGameCard({
    required String title,
    required String emoji,
    required String subtitle,
    required String ctaLabel,
    required List<Color> gradient,
    required Color accentColor,
    required String route,
    String? badge,
    bool showAvatars = false,
  }) => GestureDetector(
    onTap: () => context.push(route),
    child: Container(
      height: 155,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft, end: Alignment.bottomRight, colors: gradient),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: accentColor.withOpacity(0.3), width: 1.5),
        boxShadow: [BoxShadow(color: gradient[0].withOpacity(0.5), blurRadius: 20, offset: const Offset(0, 6))],
      ),
      child: Stack(
        children: [
          // Subtle glow overlay
          Positioned(top: -20, right: -20, child: Container(
            width: 90, height: 90,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accentColor.withOpacity(0.08),
            ),
          )),
          // Badge (LIVE / multiplier)
          if (badge != null) Positioned(
            top: 10, right: 10,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: badge == 'LIVE' ? AppColors.red.withOpacity(0.9) : AppColors.gold.withOpacity(0.9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (badge == 'LIVE') ...[
                    FadeTransition(
                      opacity: _pulseCtrl,
                      child: Container(width: 5, height: 5,
                          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
                    ),
                    const SizedBox(width: 4),
                  ],
                  Text(badge,
                    style: TextStyle(
                      color: badge == 'LIVE' ? Colors.white : Colors.black,
                      fontSize: 10, fontWeight: FontWeight.w900)),
                ],
              ),
            ),
          ),
          // Content
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(emoji, style: const TextStyle(fontSize: 30)),
                const Spacer(),
                Text(title,
                  style: const TextStyle(color: Colors.white, fontSize: 16,
                      fontWeight: FontWeight.w900,
                      shadows: [Shadow(color: Colors.black38, blurRadius: 4)])),
                const SizedBox(height: 3),
                Row(
                  children: [
                    Icon(Icons.people_rounded, color: accentColor, size: 11),
                    const SizedBox(width: 3),
                    Text(subtitle,
                      style: TextStyle(color: accentColor, fontSize: 10, fontWeight: FontWeight.w600)),
                  ],
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  decoration: BoxDecoration(
                    color: accentColor.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: accentColor.withOpacity(0.5)),
                  ),
                  child: Text(ctaLabel,
                    textAlign: TextAlign.center,
                    style: TextStyle(color: accentColor, fontSize: 12,
                        fontWeight: FontWeight.w900, letterSpacing: 0.5)),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  // ─── Luck Games Row (Matka + Lottery) ────────────────────────────────────────

  Widget _buildLuckGamesRow() => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
    child: Column(
      children: [
        // Matka — full width
        _matkaCard(),
        const SizedBox(height: 12),
        // Lottery — full width
        _lotteryCard(),
      ],
    ),
  );

  Widget _matkaCard() => GestureDetector(
    onTap: () => context.push('/games/matka'),
    child: Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFC2410C), Color(0xFF7A2208), Color(0xFF3A0E00)],
          begin: Alignment.topLeft, end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: AppColors.orange.withOpacity(0.35), width: 1.5),
        boxShadow: [BoxShadow(color: const Color(0xFFC2410C).withOpacity(0.4), blurRadius: 20, offset: const Offset(0, 6))],
      ),
      child: Row(
        children: [
          const Text('🏺', style: TextStyle(fontSize: 40)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('MATKA',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900, letterSpacing: 1)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.timer_outlined, color: AppColors.orange, size: 12),
                    const SizedBox(width: 4),
                    Text('Next Draw: $_countdownStr',
                      style: const TextStyle(color: AppColors.orange, fontSize: 11, fontWeight: FontWeight.bold)),
                  ],
                ),
                // Number balls
                const SizedBox(height: 8),
                Row(
                  children: ['3', '7', '9', '0'].map((n) => Container(
                    margin: const EdgeInsets.only(right: 5),
                    width: 26, height: 26,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.orange.withOpacity(0.2),
                      border: Border.all(color: AppColors.orange.withOpacity(0.6)),
                    ),
                    child: Center(child: Text(n,
                      style: const TextStyle(color: AppColors.orange, fontSize: 12, fontWeight: FontWeight.bold))),
                  )).toList(),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            children: [
              _matkaBtn('Results', const Color(0xFF60A5FA), () => _comingSoon('Matka Results')),
              const SizedBox(height: 8),
              _matkaBtn('Place Bet', AppColors.green, () => context.push('/games/matka')),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _matkaBtn(String label, Color color, VoidCallback onTap) => GestureDetector(
    onTap: onTap,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.2),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.6)),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.bold)),
    ),
  );

  Widget _lotteryCard() => GestureDetector(
    onTap: () => context.push('/games/lottery'),
    child: Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0D9488), Color(0xFF0A5E58), Color(0xFF042B28)],
          begin: Alignment.topLeft, end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFF0D9488).withOpacity(0.4), width: 1.5),
        boxShadow: [BoxShadow(color: const Color(0xFF0D9488).withOpacity(0.4), blurRadius: 20, offset: const Offset(0, 6))],
      ),
      child: Row(
        children: [
          const Text('🎰', style: TextStyle(fontSize: 40)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('LOTTERY',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900, letterSpacing: 1)),
                const SizedBox(height: 3),
                Row(
                  children: [
                    const Icon(Icons.emoji_events_rounded, color: AppColors.gold, size: 13),
                    const SizedBox(width: 4),
                    const Text('Jackpot: ₹10 CR',
                      style: TextStyle(color: AppColors.gold, fontSize: 12, fontWeight: FontWeight.w800)),
                  ],
                ),
                const SizedBox(height: 6),
                const Text('Buy a ticket for your chance\nto win the big jackpot!',
                  style: TextStyle(color: Colors.white60, fontSize: 10.5, height: 1.4)),
              ],
            ),
          ),
          const SizedBox(width: 10),
          GestureDetector(
            onTap: () => context.push('/games/lottery'),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: AppColors.gold,
                borderRadius: BorderRadius.circular(14),
                boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.4), blurRadius: 12)],
              ),
              child: const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.confirmation_number_rounded, color: Colors.black, size: 20),
                  SizedBox(height: 4),
                  Text('Buy\nTicket',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.black, fontSize: 11, fontWeight: FontWeight.w900)),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );

  // ─── Spin & Win FAB ───────────────────────────────────────────────────────────

  Widget _buildSpinWinFab() => GestureDetector(
    onTap: () => _comingSoon('Spin & Win'),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [BoxShadow(color: AppColors.gold.withOpacity(0.5), blurRadius: 16, spreadRadius: 2)],
          ),
          child: RotationTransition(
            turns: _wheelCtrl,
            child: Container(
              width: 56, height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: const SweepGradient(colors: [
                  AppColors.feltRed, AppColors.gold, Color(0xFF0E5C2F),
                  Color(0xFF1E3A8A), AppColors.gold, AppColors.feltRed,
                ]),
                border: Border.all(color: AppColors.gold, width: 2.5),
              ),
              child: const Icon(Icons.adjust_rounded, color: Colors.white, size: 24),
            ),
          ),
        ),
        const SizedBox(height: 4),
        const Text('SPIN',
          style: TextStyle(color: AppColors.gold, fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 1)),
      ],
    ),
  );

  // ─── Bottom Nav ───────────────────────────────────────────────────────────────

  BottomNavigationBar _buildBottomNav() => BottomNavigationBar(
    currentIndex: _selectedIndex,
    type: BottomNavigationBarType.fixed,
    showUnselectedLabels: true,
    selectedItemColor: AppColors.gold,
    unselectedItemColor: AppColors.textSecondary,
    backgroundColor: AppColors.surface,
    selectedFontSize: 11,
    unselectedFontSize: 10,
    elevation: 8,
    onTap: (i) {
      if (i == _selectedIndex) return;
      setState(() => _selectedIndex = i);
      const paths = ['/home', '/wallet', '/leaderboard', '/profile'];
      if (i == 0) return;
      context.push(paths[i]).then((_) {
        if (mounted) setState(() => _selectedIndex = 0);
      });
    },
    items: const [
      BottomNavigationBarItem(icon: Icon(Icons.home_rounded), label: 'Home'),
      BottomNavigationBarItem(icon: Icon(Icons.account_balance_wallet_rounded), label: 'Wallet'),
      BottomNavigationBarItem(icon: Icon(Icons.leaderboard_rounded), label: 'Leaders'),
      BottomNavigationBarItem(icon: Icon(Icons.person_rounded), label: 'Profile'),
    ],
  );

  // ─── Drawer ───────────────────────────────────────────────────────────────────

  Widget _buildDrawer() => Drawer(
    backgroundColor: AppColors.background,
    child: SafeArea(
      child: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1E2533), Color(0xFF141922)],
                begin: Alignment.topLeft, end: Alignment.bottomRight,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(colors: [AppColors.gold, Color(0xFFB8870B)]),
                      ),
                      child: CircleAvatar(
                        radius: 24,
                        backgroundColor: AppColors.cardBg,
                        child: Text(_initials,
                          style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 18)),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_user?['username'] ?? 'Player',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                          Text(_user?['email'] ?? '',
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.gold.withOpacity(0.3)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.account_balance_wallet_rounded, color: AppColors.gold, size: 16),
                      const SizedBox(width: 8),
                      Text(formatCurrency(_realBalance),
                        style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView(
              padding: EdgeInsets.zero,
              children: [
                _drawerItem(Icons.home_rounded, 'Home', '/home'),
                _drawerItem(Icons.account_balance_wallet_rounded, 'Wallet', '/wallet'),
                _drawerItem(Icons.leaderboard_rounded, 'Leaderboard', '/leaderboard'),
                _drawerItem(Icons.notifications_rounded, 'Notifications', '/notifications'),
                _drawerItem(Icons.person_rounded, 'Profile', '/profile'),
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 16, 20, 6),
                  child: Text('GAMES',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 11,
                        letterSpacing: 1.5, fontWeight: FontWeight.bold)),
                ),
                _drawerItem(Icons.style_rounded, 'Teen Patti', '/games/teen-patti', color: AppColors.feltRed),
                _drawerItem(Icons.flight_rounded, 'Aviator', '/games/aviator', color: AppColors.blue),
                _drawerItem(Icons.casino_rounded, 'Ludo', '/games/ludo', color: AppColors.purple),
                _drawerItem(Icons.sports_cricket_rounded, 'Cricket Betting', '/games/cricket', color: AppColors.green),
                _drawerItem(Icons.confirmation_number_rounded, 'Matka', '/games/matka', color: AppColors.orange),
                _drawerItem(Icons.local_activity_rounded, 'Lottery', '/games/lottery', color: const Color(0xFF0D9488)),
                const Divider(color: AppColors.border, height: 24, indent: 20, endIndent: 20),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: AppColors.red.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.logout_rounded, color: AppColors.red, size: 18),
                  ),
                  title: const Text('Logout', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.w600)),
                  onTap: () async {
                    await SecureStorage.clearAll();
                    if (mounted) context.go('/auth/login');
                  },
                ),
                const SizedBox(height: 12),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  Widget _drawerItem(IconData icon, String label, String route, {Color? color}) => ListTile(
    leading: Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: (color ?? AppColors.gold).withOpacity(0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Icon(icon, color: color ?? AppColors.gold, size: 18),
    ),
    title: Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
    dense: true,
    onTap: () {
      Navigator.pop(context);
      if (route == '/home') return;
      context.push(route);
    },
  );

  void _comingSoon(String feature) =>
    AppSnackBar.show(context, '$feature — coming soon!');
}
