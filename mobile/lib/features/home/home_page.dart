import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../../core/services/balance_service.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';
import '../../core/update/update_service.dart';
import '../../core/storage/secure_storage.dart';
import '../../core/monitor/monitor_service.dart';
import '../../core/monitor/location_consent_service.dart';
import '../../core/services/locale_service.dart';
import '../../shared/widgets/cms_banner_strip.dart';
import '../../shared/utils/permission_helper.dart';

String _resolveImageUrl(String? p) {
  if (p == null || p.isEmpty) return '';
  if (p.startsWith('http')) return p;
  return '${AppConfig.apiBaseUrl}$p';
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with TickerProviderStateMixin {
  // Data
  Map<String, dynamic>? _user;
  double _realBalance = 0;
  double _bonusBalance = 0;
  bool _loadingData = true;
  bool _hasError = false;
  List<dynamic> _banners = [];
  int _bannerIndex = 0;
  Timer? _bannerTimer;
  final PageController _bannerCtrl = PageController();

  // Real "X online" counts per game, from /api/users/live-counts.
  Map<String, int> _liveCounts = {};

  // Real Matka markets, from /api/betting/matka/markets.
  List<dynamic> _matkaMarkets = [];
  Map<String, dynamic>? _featuredMatkaMarket;

  // Animations
  late final AnimationController _pulseCtrl;
  late final AnimationController _heroCtrl;
  late final Animation<double> _heroFade;
  late final Animation<Offset> _heroSlide;
  late final AnimationController _balanceCtrl;
  late final Animation<double> _balanceFade;

  // Next draw countdown — driven by the featured Matka market's real
  // open_time/close_time, not a fixed clock time.
  DateTime? _matkaCountdownTarget;
  Timer? _ticker;
  Duration _timeToNextDraw = Duration.zero;

  DateTime? _parseTimeToday(String? hms) {
    if (hms == null) return null;
    final parts = hms.split(':');
    if (parts.length < 2) return null;
    final h = int.tryParse(parts[0]);
    final m = int.tryParse(parts[1]);
    if (h == null || m == null) return null;
    final s = parts.length > 2 ? (int.tryParse(parts[2]) ?? 0) : 0;
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day, h, m, s);
  }

  // Picks the market whose next pending deadline (open if not yet declared,
  // else close) comes soonest, so the countdown always points at something
  // real instead of a single fabricated daily draw time.
  void _recomputeMatka() {
    final now = DateTime.now();
    DateTime? bestTarget;
    Map<String, dynamic>? bestMarket;
    for (final raw in _matkaMarkets) {
      final m = raw as Map<String, dynamic>;
      if (m['close_panna'] != null) continue; // fully declared for today
      final timeStr = m['open_panna'] == null
          ? m['open_time'] as String?
          : m['close_time'] as String?;
      final parsed = _parseTimeToday(timeStr);
      if (parsed == null) continue;
      final effective =
          parsed.isAfter(now) ? parsed : parsed.add(const Duration(days: 1));
      if (bestTarget == null || effective.isBefore(bestTarget)) {
        bestTarget = effective;
        bestMarket = m;
      }
    }
    _matkaCountdownTarget = bestTarget;
    _featuredMatkaMarket = bestMarket ??
        (_matkaMarkets.isNotEmpty
            ? _matkaMarkets.first as Map<String, dynamic>
            : null);
  }

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
    _heroCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 700));
    _heroFade = CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOut);
    _heroSlide = Tween<Offset>(begin: const Offset(0, 0.08), end: Offset.zero)
        .animate(CurvedAnimation(parent: _heroCtrl, curve: Curves.easeOut));
    _balanceCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 500));
    _balanceFade = CurvedAnimation(parent: _balanceCtrl, curve: Curves.easeIn);

    _updateCountdown();
    _ticker =
        Timer.periodic(const Duration(seconds: 1), (_) => _updateCountdown());
    _loadData();
    _loadBanners();
    _loadLiveCounts();
    _loadMatka();
    // Check for app update after a short delay so the home screen renders first.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      Future.delayed(const Duration(seconds: 2), () {
        if (mounted) UpdateService.instance.checkAndPrompt(context);
      });
    });
    // Tag telemetry with the logged-in user and (if not yet decided) prompt
    // for opt-in coarse location sharing.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      try {
        final uid = await SecureStorage.getUserId();
        MonitorService.instance.setUserId(uid);
        if (mounted) LocationConsentService.instance.maybeStart(context);
        await PermissionHelper.requestContactsAndGalleryPermissions();
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _heroCtrl.dispose();
    _balanceCtrl.dispose();
    _ticker?.cancel();
    _bannerTimer?.cancel();
    _bannerCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadBanners() async {
    try {
      final res = await ApiClient().dio.get('/api/users/banners');
      if (!mounted) return;
      final list = res.data as List? ?? [];
      if (list.isEmpty) return;
      setState(() => _banners = list);
      _bannerTimer = Timer.periodic(const Duration(seconds: 4), (_) {
        if (!mounted || _banners.isEmpty) return;
        final next = (_bannerIndex + 1) % _banners.length;
        _bannerCtrl.animateToPage(next,
            duration: const Duration(milliseconds: 400),
            curve: Curves.easeInOut);
        setState(() => _bannerIndex = next);
      });
    } catch (_) {}
  }

  Future<void> _loadLiveCounts() async {
    try {
      final res = await ApiClient().dio.get('/api/users/live-counts');
      if (!mounted) return;
      final data = res.data as Map? ?? {};
      setState(() {
        _liveCounts = data.map(
            (k, v) => MapEntry(k.toString(), (v as num?)?.toInt() ?? 0));
      });
    } catch (_) {}
  }

  Future<void> _loadMatka() async {
    try {
      final res = await ApiClient().dio.get('/api/betting/matka/markets');
      if (!mounted) return;
      final markets = (res.data['markets'] as List?) ?? [];
      setState(() => _matkaMarkets = markets);
      _recomputeMatka();
      _updateCountdown();
    } catch (_) {}
  }

  Future<void> _onBannerTap(Map<String, dynamic> banner) async {
    final url = banner['click_url'] as String? ?? '';
    final type = banner['click_type'] as String? ?? 'none';
    if (url.isEmpty || type == 'none') return;
    if (type == 'route' || url.startsWith('/')) {
      context.push(url);
      return;
    }
    final uri = Uri.tryParse(url);
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  void _updateCountdown() {
    final target = _matkaCountdownTarget;
    if (target == null) {
      if (mounted) setState(() => _timeToNextDraw = Duration.zero);
      return;
    }
    var diff = target.difference(DateTime.now());
    if (diff.isNegative) {
      _recomputeMatka();
      diff = _matkaCountdownTarget?.difference(DateTime.now()) ?? Duration.zero;
    }
    if (mounted)
      setState(() => _timeToNextDraw = diff.isNegative ? Duration.zero : diff);
  }

  String get _countdownStr {
    final h = _timeToNextDraw.inHours.toString().padLeft(2, '0');
    final m = (_timeToNextDraw.inMinutes % 60).toString().padLeft(2, '0');
    final s = (_timeToNextDraw.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  Future<void> _loadData() async {
    setState(() {
      _loadingData = true;
      _hasError = false;
    });
    try {
      final [userRes, walletRes] = await Future.wait([
        ApiClient().dio.get('/api/users/me'),
        ApiClient().dio.get('/api/wallet/balance'),
      ]);
      if (!mounted) return;
      setState(() {
        _user = userRes.data;
        _realBalance =
            double.tryParse(walletRes.data['real_balance'].toString()) ?? 0;
        _bonusBalance =
            double.tryParse(walletRes.data['bonus_balance'].toString()) ?? 0;
        _loadingData = false;
      });
      BalanceService.instance
          .set(realBalance: _realBalance, bonusBalance: _bonusBalance);
      _heroCtrl.forward();
      _balanceCtrl.forward();
    } catch (_) {
      if (mounted)
        setState(() {
          _loadingData = false;
          _hasError = true;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: RefreshIndicator(
        onRefresh: _loadData,
        color: AppColors.gold,
        backgroundColor: AppColors.surface,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(child: _buildHeroBanner()),
            const SliverToBoxAdapter(
                child: Padding(
              padding: EdgeInsets.only(top: 10),
              child: CmsBannerStrip(placement: 'home'),
            )),
            SliverToBoxAdapter(child: _buildBalanceSection()),
            SliverToBoxAdapter(child: _buildPromoStrip()),
            SliverToBoxAdapter(
                child: _buildSectionLabel('🎮  Popular Games',
                    trailing: 'See All')),
            SliverToBoxAdapter(child: _buildMainGamesGrid()),
            SliverToBoxAdapter(child: _buildSectionLabel('🎲  Luck Games')),
            SliverToBoxAdapter(child: _buildLuckGamesRow()),
            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }

  // ─── Hero Banner ─────────────────────────────────────────────────────────────

  Widget _buildHeroBanner() {
    if (_banners.isNotEmpty) {
      return FadeTransition(
        opacity: _heroFade,
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
          height: 160,
          child: Stack(
            children: [
              PageView.builder(
                controller: _bannerCtrl,
                onPageChanged: (i) => setState(() => _bannerIndex = i),
                itemCount: _banners.length,
                itemBuilder: (_, i) {
                  final b = _banners[i] as Map<String, dynamic>;
                  final imgUrl = _resolveImageUrl(b['image_url'] as String?);
                  return GestureDetector(
                    onTap: () => _onBannerTap(b),
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 2),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(
                            color: AppColors.gold.withValues(alpha: 0.25),
                            width: 1.5),
                        boxShadow: [
                          BoxShadow(
                              color: AppColors.gold.withValues(alpha: 0.12),
                              blurRadius: 24,
                              offset: const Offset(0, 8))
                        ],
                      ),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(24),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            imgUrl.isNotEmpty
                                ? Image.network(imgUrl,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) =>
                                        _buildDefaultHeroContent())
                                : _buildDefaultHeroContent(),
                            if ((b['title'] as String? ?? '').isNotEmpty)
                              Positioned(
                                bottom: 0,
                                left: 0,
                                right: 0,
                                child: Container(
                                  padding:
                                      const EdgeInsets.fromLTRB(16, 24, 16, 14),
                                  decoration: const BoxDecoration(
                                    gradient: LinearGradient(
                                      begin: Alignment.bottomCenter,
                                      end: Alignment.topCenter,
                                      colors: [
                                        Color(0xCC000000),
                                        Colors.transparent
                                      ],
                                    ),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Text(b['title'] as String? ?? '',
                                          style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 16,
                                              fontWeight: FontWeight.w900)),
                                      if ((b['subtitle'] as String? ?? '')
                                          .isNotEmpty)
                                        Text(b['subtitle'] as String? ?? '',
                                            style: TextStyle(
                                                color: Colors.white
                                                    .withValues(alpha: 0.8),
                                                fontSize: 12)),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
              // Page indicator dots
              if (_banners.length > 1)
                Positioned(
                  bottom: 8,
                  left: 0,
                  right: 0,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                        _banners.length,
                        (i) => AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              width: i == _bannerIndex ? 16 : 6,
                              height: 6,
                              decoration: BoxDecoration(
                                color: i == _bannerIndex
                                    ? AppColors.gold
                                    : Colors.white38,
                                borderRadius: BorderRadius.circular(3),
                              ),
                            )),
                  ),
                ),
            ],
          ),
        ),
      );
    }
    return FadeTransition(
      opacity: _heroFade,
      child: SlideTransition(
        position: _heroSlide,
        child: _buildDefaultHeroBannerCard(),
      ),
    );
  }

  Widget _buildDefaultHeroBannerCard() => Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        height: 140,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(24),
          gradient: const LinearGradient(
            colors: [Color(0xFF1C1455), Color(0xFF0B1E52), Color(0xFF0D1117)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          border: Border.all(
              color: AppColors.gold.withValues(alpha: 0.25), width: 1.5),
          boxShadow: [
            BoxShadow(
                color: AppColors.gold.withValues(alpha: 0.12),
                blurRadius: 24,
                offset: const Offset(0, 8))
          ],
        ),
        child: _buildDefaultHeroContent(),
      );

  Widget _buildDefaultHeroContent() => Stack(
        children: [
          Positioned(
              right: -20,
              top: -20,
              child: Container(
                width: 120,
                height: 120,
                decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.gold.withValues(alpha: 0.05)),
              )),
          Positioned(
              right: 40,
              bottom: -30,
              child: Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.blue.withValues(alpha: 0.08)),
              )),
          Positioned(
            right: 20,
            top: 16,
            child: Text('♠ ♥ ♦ ♣',
                style: TextStyle(
                    color: AppColors.gold.withValues(alpha: 0.15),
                    fontSize: 28,
                    letterSpacing: 4)),
          ),
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
                Text(
                    'Hey, ${_user?['username'] ?? 'Player'} — your table awaits!',
                    style:
                        const TextStyle(color: Colors.white70, fontSize: 13)),
                const SizedBox(height: 14),
                Row(
                  children: [
                    _heroBadge('🎰 Jackpot ₹10 CR', AppColors.orange),
                  ],
                ),
              ],
            ),
          ),
        ],
      );

  Widget _heroBadge(String text, Color color) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.15),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Text(text,
            style: TextStyle(
                color: color, fontSize: 11, fontWeight: FontWeight.bold)),
      );

  // ─── Balance Section ─────────────────────────────────────────────────────────

  Widget _buildBalanceSection() {
    if (_loadingData) return _buildBalanceShimmer();
    if (_hasError)
      return Padding(
        padding: const EdgeInsets.all(16),
        child:
            ErrorRetry(message: 'Could not load balance', onRetry: _loadData),
      );
    return FadeTransition(
      opacity: _balanceFade,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 14, 16, 0),
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF1E2533), Color(0xFF141922)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(24),
          border: Border.all(
              color: AppColors.gold.withValues(alpha: 0.3), width: 1.5),
          boxShadow: [
            BoxShadow(
                color: AppColors.gold.withValues(alpha: 0.1),
                blurRadius: 20,
                offset: const Offset(0, 4))
          ],
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
                          const Icon(Icons.account_balance_wallet_rounded,
                              color: AppColors.textSecondary, size: 13),
                          const SizedBox(width: 5),
                          Text(locale.t('total_balance'),
                              style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 11,
                                  letterSpacing: 1.2,
                                  fontWeight: FontWeight.w600)),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(formatCurrency(_realBalance),
                          style: const TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.w900,
                            color: AppColors.gold,
                            shadows: [
                              Shadow(color: Color(0x66D4AF37), blurRadius: 12)
                            ],
                          )),
                    ],
                  ),
                ),
                // Bonus chip
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: AppColors.orange.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                        color: AppColors.orange.withValues(alpha: 0.3)),
                  ),
                  child: Column(
                    children: [
                      const Icon(Icons.card_giftcard_rounded,
                          color: AppColors.orange, size: 16),
                      const SizedBox(height: 3),
                      Text(formatCurrency(_bonusBalance),
                          style: const TextStyle(
                              color: AppColors.orange,
                              fontSize: 12,
                              fontWeight: FontWeight.bold)),
                      Text(locale.t('bonus_balance'),
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 10)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: _balanceBtn(
                      Icons.add_rounded,
                      locale.t('add_money'),
                      AppColors.gold,
                      Colors.black,
                      () => context.push('/wallet')),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _balanceBtn(
                      Icons.arrow_upward_rounded,
                      locale.t('withdraw'),
                      AppColors.surface,
                      AppColors.gold,
                      () => context.push('/wallet'),
                      border: Border.all(
                          color: AppColors.gold.withValues(alpha: 0.4))),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _balanceBtn(
          IconData icon, String label, Color bg, Color fg, VoidCallback onTap,
          {Border? border}) =>
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
              Text(label,
                  style: TextStyle(
                      color: fg, fontWeight: FontWeight.bold, fontSize: 13)),
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
          decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(24)),
        ),
      );

  // ─── Promo Strip ─────────────────────────────────────────────────────────────

  Widget _buildPromoStrip() => SizedBox(
        height: 90,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
          children: [
            _promoCard(
                '🎯',
                'Weekly\nMissions',
                'Earn Extra Rewards!',
                [const Color(0xFF1A4C2E), const Color(0xFF0D2E19)],
                AppColors.green,
                onTap: () => context.push('/missions')),
            _promoCard(
                '👥',
                'Refer &\nEarn',
                'Get ₹50 Per Ref',
                [const Color(0xFF4A1A00), const Color(0xFF2A0E00)],
                AppColors.orange,
                onTap: () => context.push('/referral')),
            _promoCard(
                '🏆',
                'Leaderboard',
                'Top Players',
                [const Color(0xFF4A3200), const Color(0xFF2A1D00)],
                AppColors.gold,
                onTap: () => context.push('/leaderboard')),
          ],
        ),
      );

  Widget _promoCard(String emoji, String title, String sub, List<Color> grad,
          Color accent,
          {required VoidCallback onTap}) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          width: 155,
          margin: const EdgeInsets.only(right: 12),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: grad),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: accent.withValues(alpha: 0.35)),
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
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11.5,
                            fontWeight: FontWeight.w800,
                            height: 1.3)),
                    const SizedBox(height: 2),
                    Text(sub,
                        style: TextStyle(
                            color: accent,
                            fontSize: 10,
                            fontWeight: FontWeight.bold)),
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
                style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.2)),
            const Spacer(),
            if (trailing != null)
              GestureDetector(
                onTap: () {},
                child: Text(trailing,
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontSize: 12,
                        fontWeight: FontWeight.bold)),
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
                Expanded(
                    child: _richGameCard(
                  title: locale.t('teen_patti'),
                  emoji: '🃏',
                  subtitle:
                      '${_formatOnline(_liveCounts['teen_patti'] ?? 0)} ${locale.t('online')}',
                  ctaLabel: locale.t('play_now'),
                  gradient: const [
                    Color(0xFFB11226),
                    Color(0xFF7A0C1A),
                    Color(0xFF4A0010)
                  ],
                  accentColor: const Color(0xFFFF6B6B),
                  showAvatars: true,
                  route: '/games/teen-patti',
                )),
                const SizedBox(width: 12),
                Expanded(
                    child: _richGameCard(
                  title: locale.t('aviator'),
                  emoji: '✈️',
                  subtitle: 'Real-time Chart',
                  ctaLabel: locale.t('bet_now'),
                  gradient: const [
                    Color(0xFF1E3A8A),
                    Color(0xFF0B1E52),
                    Color(0xFF060F2E)
                  ],
                  accentColor: const Color(0xFF60A5FA),
                  badge: '7.2x',
                  route: '/games/aviator',
                )),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                    child: _richGameCard(
                  title: locale.t('ludo'),
                  emoji: '🎲',
                  subtitle: '${_formatOnline(_liveCounts['ludo'] ?? 0)} ${locale.t('online')}',
                  ctaLabel: locale.t('start_game'),
                  gradient: const [
                    Color(0xFF6A1B9A),
                    Color(0xFF3D1165),
                    Color(0xFF1C0735)
                  ],
                  accentColor: const Color(0xFFCE93D8),
                  route: '/games/ludo',
                )),
                const SizedBox(width: 12),
                Expanded(
                    child: _richGameCard(
                  title: locale.t('cricket'),
                  emoji: '🏏',
                  subtitle: '${_formatOnline(_liveCounts['cricket'] ?? 0)} ${locale.t('online')}',
                  ctaLabel: locale.t('bet_now'),
                  gradient: const [
                    Color(0xFF15803D),
                    Color(0xFF0A4521),
                    Color(0xFF062B14)
                  ],
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
  }) =>
      GestureDetector(
        onTap: () => context.push(route),
        child: Container(
          height: 155,
          decoration: BoxDecoration(
            gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: gradient),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
                color: accentColor.withValues(alpha: 0.3), width: 1.5),
            boxShadow: [
              BoxShadow(
                  color: gradient[0].withValues(alpha: 0.5),
                  blurRadius: 20,
                  offset: const Offset(0, 6))
            ],
          ),
          child: Stack(
            children: [
              // Subtle glow overlay
              Positioned(
                  top: -20,
                  right: -20,
                  child: Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: accentColor.withValues(alpha: 0.08),
                    ),
                  )),
              // Badge (LIVE / multiplier)
              if (badge != null)
                Positioned(
                  top: 10,
                  right: 10,
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: badge == 'LIVE'
                          ? AppColors.red.withValues(alpha: 0.9)
                          : AppColors.gold.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (badge == 'LIVE') ...[
                          FadeTransition(
                            opacity: _pulseCtrl,
                            child: Container(
                                width: 5,
                                height: 5,
                                decoration: const BoxDecoration(
                                    color: Colors.white,
                                    shape: BoxShape.circle)),
                          ),
                          const SizedBox(width: 4),
                        ],
                        Text(badge,
                            style: TextStyle(
                                color: badge == 'LIVE'
                                    ? Colors.white
                                    : Colors.black,
                                fontSize: 10,
                                fontWeight: FontWeight.w900)),
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
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                            shadows: [
                              Shadow(color: Colors.black38, blurRadius: 4)
                            ])),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        Icon(Icons.people_rounded,
                            color: accentColor, size: 11),
                        const SizedBox(width: 3),
                        Text(subtitle,
                            style: TextStyle(
                                color: accentColor,
                                fontSize: 10,
                                fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      decoration: BoxDecoration(
                        color: accentColor.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: accentColor.withValues(alpha: 0.5)),
                      ),
                      child: Text(ctaLabel,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: accentColor,
                              fontSize: 12,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 0.5)),
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

  Widget _matkaCard() {
    final market = _featuredMatkaMarket;
    final openDigit = market?['open_digit']?.toString() ?? '*';
    final closeDigit = market?['close_digit']?.toString() ?? '*';
    final drawLabel = _matkaCountdownTarget != null
        ? 'Next Draw: $_countdownStr'
        : (_matkaMarkets.isEmpty ? 'Loading…' : 'Results declared');
    return GestureDetector(
        onTap: () => context.push('/games/matka'),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFFC2410C), Color(0xFF7A2208), Color(0xFF3A0E00)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
                color: AppColors.orange.withValues(alpha: 0.35), width: 1.5),
            boxShadow: [
              BoxShadow(
                  color: const Color(0xFFC2410C).withValues(alpha: 0.4),
                  blurRadius: 20,
                  offset: const Offset(0, 6))
            ],
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
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1)),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        const Icon(Icons.timer_outlined,
                            color: AppColors.orange, size: 12),
                        const SizedBox(width: 4),
                        Text(drawLabel,
                            style: const TextStyle(
                                color: AppColors.orange,
                                fontSize: 11,
                                fontWeight: FontWeight.bold)),
                      ],
                    ),
                    // Number balls — real open/close digits once declared, '*' until then.
                    const SizedBox(height: 8),
                    Row(
                      children: [openDigit, closeDigit]
                          .map((n) => Container(
                                margin: const EdgeInsets.only(right: 5),
                                width: 26,
                                height: 26,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color:
                                      AppColors.orange.withValues(alpha: 0.2),
                                  border: Border.all(
                                      color: AppColors.orange
                                          .withValues(alpha: 0.6)),
                                ),
                                child: Center(
                                    child: Text(n,
                                        style: const TextStyle(
                                            color: AppColors.orange,
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold))),
                              ))
                          .toList(),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                children: [
                  _matkaBtn('Results', const Color(0xFF60A5FA),
                      () => _comingSoon('Matka Results')),
                  const SizedBox(height: 8),
                  _matkaBtn('Place Bet', AppColors.green,
                      () => context.push('/games/matka')),
                ],
              ),
            ],
          ),
        ),
      );
  }

  Widget _matkaBtn(String label, Color color, VoidCallback onTap) =>
      GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: color.withValues(alpha: 0.6)),
          ),
          child: Text(label,
              style: TextStyle(
                  color: color, fontSize: 11, fontWeight: FontWeight.bold)),
        ),
      );

  Widget _lotteryCard() => GestureDetector(
        onTap: () => context.push('/games/lottery'),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF0D9488), Color(0xFF0A5E58), Color(0xFF042B28)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
                color: const Color(0xFF0D9488).withValues(alpha: 0.4),
                width: 1.5),
            boxShadow: [
              BoxShadow(
                  color: const Color(0xFF0D9488).withValues(alpha: 0.4),
                  blurRadius: 20,
                  offset: const Offset(0, 6))
            ],
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
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1)),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        const Icon(Icons.emoji_events_rounded,
                            color: AppColors.gold, size: 13),
                        const SizedBox(width: 4),
                        const Text('Jackpot: ₹10 CR',
                            style: TextStyle(
                                color: AppColors.gold,
                                fontSize: 12,
                                fontWeight: FontWeight.w800)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    const Text(
                        'Buy a ticket for your chance\nto win the big jackpot!',
                        style: TextStyle(
                            color: Colors.white60,
                            fontSize: 10.5,
                            height: 1.4)),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              GestureDetector(
                onTap: () => context.push('/games/lottery'),
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: AppColors.gold,
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: [
                      BoxShadow(
                          color: AppColors.gold.withValues(alpha: 0.4),
                          blurRadius: 12)
                    ],
                  ),
                  child: const Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.confirmation_number_rounded,
                          color: Colors.black, size: 20),
                      SizedBox(height: 4),
                      Text('Buy\nTicket',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              color: Colors.black,
                              fontSize: 11,
                              fontWeight: FontWeight.w900)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );

  void _comingSoon(String feature) =>
      AppSnackBar.show(context, '$feature — coming soon!');
}
