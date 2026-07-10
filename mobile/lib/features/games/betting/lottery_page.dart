import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

// ─────────────────────────────────────────────────────────────────────────────
//  Lottery Page — all draws & settings managed from admin panel
// ─────────────────────────────────────────────────────────────────────────────
class LotteryPage extends StatefulWidget {
  const LotteryPage({super.key});
  @override
  State<LotteryPage> createState() => _LotteryPageState();
}

class _LotteryPageState extends State<LotteryPage> with TickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  List<dynamic> _results = [];
  bool _loading = true;
  bool _myLoading = false;
  bool _resLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) {
        if (_tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
        if (_tab.index == 2 && _results.isEmpty) _loadResults();
      }
    });
    _loadDraws();
    _loadBalance();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }

  @override
  void dispose() {
    _tab.dispose();
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _loadDraws() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/draws');
      if (!mounted) return;
      setState(() { _draws = res.data['draws'] ?? []; _loading = false; });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadBalance() async {
    try {
      final res = await ApiClient().dio.get('/api/wallet/balance');
      if (!mounted) return;
      setState(() => _balance = double.tryParse(res.data['real_balance'].toString()) ?? 0);
    } catch (_) {}
  }

  Future<void> _loadMyTickets() async {
    setState(() => _myLoading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/my-tickets');
      if (!mounted) return;
      setState(() { _myTickets = res.data['tickets'] ?? []; _myLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _myLoading = false);
    }
  }

  Future<void> _loadResults() async {
    setState(() => _resLoading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/lottery/results');
      if (!mounted) return;
      setState(() { _results = res.data['draws'] ?? []; _resLoading = false; });
    } catch (_) {
      if (mounted) setState(() => _resLoading = false);
    }
  }

  double get _totalJackpot => _draws.fold(0.0, (sum, d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final mult = double.tryParse(d['prize_multiplier']?.toString() ?? '0') ?? 0;
    return sum + price * mult;
  });

  DateTime? get _nextDraw {
    final times = _draws
        .map((d) => DateTime.tryParse(d['draw_time']?.toString() ?? ''))
        .whereType<DateTime>()
        .where((t) => t.isAfter(DateTime.now()))
        .toList()
      ..sort();
    return times.isEmpty ? null : times.first;
  }

  String _countdown(DateTime? dt) {
    if (dt == null) return '--:--:--';
    final diff = dt.difference(DateTime.now());
    if (diff.isNegative) return 'Drawing Now!';
    final h = diff.inHours;
    final m = diff.inMinutes % 60;
    final s = diff.inSeconds % 60;
    if (h > 0) {
      return '${h.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
    }
    return '${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }

  String _fmtCurrency(double v) {
    if (v >= 10000000) return '₹${(v / 10000000).toStringAsFixed(2)} Cr';
    if (v >= 100000) return '₹${(v / 100000).toStringAsFixed(1)} L';
    if (v >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
    return '₹${v.toStringAsFixed(0)}';
  }

  String _fmtDt(DateTime dt) {
    final now = DateTime.now();
    final prefix = (dt.day == now.day && dt.month == now.month) ? 'Today' : '${dt.day}/${dt.month}';
    return '$prefix ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  // ── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF03070A),
      body: NestedScrollView(
        headerSliverBuilder: (ctx, _) => [_buildSliverAppBar()],
        body: TabBarView(
          controller: _tab,
          children: [_drawsTab(), _myTicketsTab(), _resultsTab()],
        ),
      ),
    );
  }

  SliverAppBar _buildSliverAppBar() {
    final jackpot = _totalJackpot;
    final next = _nextDraw;
    return SliverAppBar(
      expandedHeight: 240,
      pinned: true,
      backgroundColor: const Color(0xFF03070A),
      leading: const BackButton(color: AppColors.gold),
      title: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('🎰', style: TextStyle(fontSize: 18)),
          SizedBox(width: 6),
          Text('LOTTERY',
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 2.5,
                  color: AppColors.goldLight)),
        ],
      ),
      actions: [
        Container(
          margin: const EdgeInsets.only(right: 12),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.gold.withOpacity(0.08),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withOpacity(0.25)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.account_balance_wallet_rounded, size: 13, color: AppColors.gold),
              const SizedBox(width: 5),
              Text('₹${_balance.toStringAsFixed(0)}',
                  style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(46),
        child: Container(
          color: const Color(0xFF03070A),
          child: TabBar(
            controller: _tab,
            indicatorColor: AppColors.gold,
            indicatorWeight: 3.0,
            labelColor: AppColors.gold,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5),
            tabs: const [Tab(text: 'Active Draws'), Tab(text: 'My Tickets'), Tab(text: 'Results')],
          ),
        ),
      ),
      flexibleSpace: FlexibleSpaceBar(
        background: _buildHeroContent(jackpot, next),
      ),
    );
  }

  Widget _buildHeroContent(double jackpot, DateTime? next) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xFF004D40), Color(0xFF002B24), Color(0xFF03070A)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: [0.0, 0.6, 1.0],
        ),
      ),
      child: Stack(
        children: [
          // Glowing shapes
          Positioned(right: -40, top: -20, child: _glowCircle(150, 0.08, color: const Color(0xFF0D9488))),
          Positioned(left: -30, bottom: 40, child: _glowCircle(110, 0.05, color: AppColors.gold)),
          Positioned(right: 60, bottom: 10, child: _glowCircle(75, 0.03, color: Colors.white)),
          // Shimmer line
          Positioned(
            top: 0, left: 0, right: 0,
            child: Container(
              height: 1.5,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.transparent, AppColors.gold.withOpacity(0.6), Colors.transparent],
                ),
              ),
            ),
          ),
          // Content
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 48, 20, 40),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'TOTAL JACKPOT PRIZEPOOL',
                    style: TextStyle(
                        color: Colors.white.withOpacity(0.5),
                        fontSize: 10,
                        letterSpacing: 4.5,
                        fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  TweenAnimationBuilder<double>(
                    key: ValueKey(jackpot),
                    tween: Tween(begin: jackpot * 0.7, end: jackpot),
                    duration: const Duration(milliseconds: 1200),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, __) => Text(
                      jackpot == 0 ? 'No Active Draws' : _fmtCurrency(v),
                      style: TextStyle(
                        fontSize: jackpot == 0 ? 22 : 44,
                        fontWeight: FontWeight.w900,
                        color: AppColors.goldLight,
                        letterSpacing: -0.5,
                        shadows: [
                          Shadow(color: AppColors.gold.withOpacity(0.7), blurRadius: 24),
                          const Shadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 4))
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  if (next != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.45),
                        borderRadius: BorderRadius.circular(30),
                        border: Border.all(color: AppColors.gold.withOpacity(0.35)),
                        boxShadow: [
                          BoxShadow(color: AppColors.gold.withOpacity(0.08), blurRadius: 10, spreadRadius: 1)
                        ]
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.alarm_rounded, color: AppColors.gold, size: 14),
                          const SizedBox(width: 6),
                          Text('Next draw in ',
                              style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 11, fontWeight: FontWeight.w600)),
                          Text(
                            _countdown(next),
                            style: const TextStyle(
                                color: AppColors.goldLight,
                                fontWeight: FontWeight.w900,
                                fontSize: 14),
                          ),
                        ],
                      ),
                    )
                  else
                    Text('No upcoming draws',
                        style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 13, fontWeight: FontWeight.w500)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _glowCircle(double size, double opacity, {Color color = Colors.white}) => Container(
    width: size, height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: color.withOpacity(opacity),
    ),
  );

  // ── Tab 1: Active Draws ─────────────────────────────────────────────────

  Widget _drawsTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_draws.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.confirmation_num_outlined,
                size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
            const SizedBox(height: 18),
            const Text('No draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Check back soon for new jackpots',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.45), fontSize: 12)),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: _loadDraws,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.gold,
                side: BorderSide(color: AppColors.gold.withOpacity(0.35)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _draws.length,
        itemBuilder: (_, i) => _drawCard(_draws[i]),
      ),
    );
  }

  Widget _drawCard(dynamic d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final mult = double.tryParse(d['prize_multiplier']?.toString() ?? '0') ?? 0;
    final digits = d['digits'] is int ? d['digits'] as int : int.tryParse(d['digits']?.toString() ?? '4') ?? 4;
    final maxPrize = price * mult;
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
    final ticketCount = int.tryParse(d['ticket_count']?.toString() ?? '0') ?? 0;
    final remaining = drawTime != null ? drawTime.difference(DateTime.now()) : Duration.zero;
    final isExpired = remaining.isNegative;

    // Progress: % of 24h window elapsed
    double progress = 0;
    if (drawTime != null && !isExpired) {
      final windowSecs = 86400;
      final elapsed = windowSecs - remaining.inSeconds.clamp(0, windowSecs);
      progress = (elapsed / windowSecs).clamp(0.0, 1.0);
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        boxShadow: isExpired
            ? []
            : [
                BoxShadow(
                  color: const Color(0xFF0D9488).withOpacity(0.12),
                  blurRadius: 18,
                  offset: const Offset(0, 6),
                )
              ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 9.0, cutLineYRatio: 0.74),
        child: Container(
          decoration: BoxDecoration(
            border: Border.all(
              color: isExpired ? AppColors.border : AppColors.gold.withOpacity(0.22),
              width: 1.2,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(22),
            child: Stack(
              children: [
                // Background gradient
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: isExpired
                            ? [const Color(0xFF1E2430), const Color(0xFF0F1217)]
                            : [const Color(0xFF0F665D), const Color(0xFF063A34), const Color(0xFF021B19)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                    ),
                  ),
                ),
                // Decorative circles
                Positioned(right: -25, top: -25, child: _glowCircle(110, 0.06, color: const Color(0xFF0D9488))),
                Positioned(right: 40, bottom: -20, child: _glowCircle(70, 0.03, color: AppColors.gold)),
                // Content
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Main top part
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
                                decoration: BoxDecoration(
                                  color: isExpired
                                      ? AppColors.border.withOpacity(0.3)
                                      : AppColors.gold.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                      color: isExpired
                                          ? AppColors.border
                                          : AppColors.gold.withOpacity(0.4)),
                                ),
                                child: Text(
                                  isExpired ? 'DRAWING' : 'OPEN',
                                  style: TextStyle(
                                      color: isExpired ? AppColors.textSecondary : AppColors.gold,
                                      fontSize: 9,
                                      fontWeight: FontWeight.w900,
                                      letterSpacing: 1.5),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(d['name'] ?? 'Lottery Draw',
                                    style: const TextStyle(
                                        fontSize: 17,
                                        fontWeight: FontWeight.w900,
                                        color: Colors.white,
                                        letterSpacing: 0.2)),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.3),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text('$digits digits',
                                    style: const TextStyle(
                                        color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 18),
                          // Stats row
                          Row(
                            children: [
                              _statChip('JACKPOT', _fmtCurrency(maxPrize), AppColors.goldLight),
                              const SizedBox(width: 8),
                              _statChip('TICKET', '₹${price.toStringAsFixed(0)}', Colors.white),
                              const SizedBox(width: 8),
                              _statChip('SOLD', '$ticketCount', const Color(0xFF2DD4BF)),
                            ],
                          ),
                          const SizedBox(height: 16),
                          // Timer/Countdown
                          Row(
                            children: [
                              Icon(
                                isExpired ? Icons.timelapse_rounded : Icons.av_timer_rounded,
                                size: 14,
                                color: isExpired ? AppColors.orange : AppColors.textSecondary,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                isExpired ? 'Draw in progress!' : 'Closes in ${_countdown(drawTime)}',
                                style: TextStyle(
                                    color: isExpired ? AppColors.orange : AppColors.textSecondary,
                                    fontSize: 12,
                                    fontWeight: isExpired ? FontWeight.w800 : FontWeight.w600),
                              ),
                              if (drawTime != null && !isExpired) ...[
                                const Spacer(),
                                Text(_fmtDt(drawTime),
                                    style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 11, fontWeight: FontWeight.w500)),
                              ],
                            ],
                          ),
                          const SizedBox(height: 8),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: isExpired ? 1.0 : progress,
                              backgroundColor: Colors.white.withOpacity(0.08),
                              valueColor: AlwaysStoppedAnimation(
                                isExpired ? AppColors.orange : AppColors.gold),
                              minHeight: 3.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    
                    // Dashed Divider at Notches Y
                    LayoutBuilder(
                      builder: (context, constraints) {
                        return CustomPaint(
                          size: Size(constraints.maxWidth, 1),
                          painter: DashedLinePainter(
                            color: Colors.white.withOpacity(0.12),
                            dashWidth: 6.0,
                            dashSpace: 4.0,
                          ),
                        );
                      },
                    ),

                    // Stub Area (Buy button)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                      child: SizedBox(
                        width: double.infinity,
                        child: ElevatedButton.icon(
                          onPressed: isExpired ? null : () {
                            SoundService.instance.play(Sfx.buttonTap);
                            _showTicketPicker(d, digits, price);
                          },
                          icon: const Icon(Icons.confirmation_num_rounded, size: 16),
                          label: const Text('Buy Ticket'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.gold,
                            foregroundColor: Colors.black,
                            disabledBackgroundColor: AppColors.border.withOpacity(0.35),
                            disabledForegroundColor: AppColors.textSecondary,
                            minimumSize: const Size.fromHeight(48),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                            textStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 14, letterSpacing: 0.5),
                            elevation: 0
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _statChip(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.24),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 8, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
            const SizedBox(height: 3),
            Text(value, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w900)),
          ],
        ),
      ),
    );
  }

  void _showTicketPicker(dynamic draw, int digits, double price) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      useSafeArea: true,
      builder: (_) => _TicketPickerSheet(
        draw: draw,
        digits: digits,
        price: price,
        balance: _balance,
        onPurchased: () {
          _loadBalance();
          _loadDraws();
          _loadMyTickets();
        },
      ),
    );
  }

  // ── Tab 2: My Tickets ───────────────────────────────────────────────────

  Widget _myTicketsTab() {
    if (_myLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_myTickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_outlined,
                size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
            const SizedBox(height: 18),
            const Text('No tickets yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Buy a ticket from Active Draws',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.45), fontSize: 12)),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: () => _tab.animateTo(0),
              icon: const Icon(Icons.confirmation_num_rounded, size: 16),
              label: const Text('See Active Draws'),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF00796B),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12)
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadMyTickets,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _myTickets.length,
        itemBuilder: (_, i) => _ticketRow(_myTickets[i]),
      ),
    );
  }

  Widget _ticketRow(dynamic t) {
    final isWinner = t['is_winner'] == true;
    final isLoser = t['is_winner'] == false;
    final prize = double.tryParse(t['prize']?.toString() ?? '0') ?? 0;
    final winNum = t['winning_number']?.toString();
    final drawStatus = t['draw_status']?.toString() ?? 'open';
    final drawTime = DateTime.tryParse(t['draw_time']?.toString() ?? '');
    final ticketNum = t['ticket_number']?.toString() ?? '';

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: isWinner
                ? AppColors.green.withOpacity(0.12)
                : Colors.black.withOpacity(0.15),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 8.0, cutLineYRatio: 0.58),
        child: Container(
          decoration: BoxDecoration(
            color: isWinner
                ? AppColors.green.withOpacity(0.04)
                : AppColors.cardBg,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isWinner
                  ? AppColors.green.withOpacity(0.45)
                  : isLoser
                      ? AppColors.border.withOpacity(0.5)
                      : AppColors.gold.withOpacity(0.2),
              width: isWinner ? 1.5 : 1.0,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Upper Part (Ticket Header & Picked Digits)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(t['draw_name'] ?? 'Lottery',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Colors.white)),
                        ),
                        _statusBadge(isWinner, isLoser, drawStatus),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Row(
                      children: [
                        Text('Your pick  ',
                            style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 11, fontWeight: FontWeight.bold)),
                        ...ticketNum.split('').map((c) => _digitDisplay(c, isWinner ? AppColors.green : null)),
                      ],
                    ),
                  ],
                ),
              ),

              // Dashed divider line
              LayoutBuilder(
                builder: (context, constraints) {
                  return CustomPaint(
                    size: Size(constraints.maxWidth, 1),
                    painter: DashedLinePainter(
                      color: Colors.white.withOpacity(0.1),
                      dashWidth: 5.0,
                      dashSpace: 3.0,
                    ),
                  );
                },
              ),

              // Lower Part (Result information, draw time)
              Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (winNum != null && drawStatus == 'settled') ...[
                      Row(
                        children: [
                          Text('Winning   ',
                              style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 11, fontWeight: FontWeight.bold)),
                          ...winNum.split('').map((c) => _digitDisplay(c, AppColors.goldLight, bold: true)),
                        ],
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (isWinner && prize > 0) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        margin: const EdgeInsets.only(bottom: 6),
                        decoration: BoxDecoration(
                          color: AppColors.green.withOpacity(0.12),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.green.withOpacity(0.35)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.emoji_events_rounded, color: AppColors.green, size: 16),
                            const SizedBox(width: 6),
                            Text('You Won ₹${prize.toStringAsFixed(0)}!',
                                style: const TextStyle(
                                    color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13)),
                          ],
                        ),
                      ),
                    ],
                    if (drawTime != null)
                      Text('Draw: ${_fmtDt(drawTime)}',
                          style: TextStyle(color: AppColors.textSecondary.withOpacity(0.5), fontSize: 10.5, fontWeight: FontWeight.w600)),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _digitDisplay(String c, Color? color, {bool bold = false}) {
    return Container(
      margin: const EdgeInsets.only(right: 5),
      width: 26, height: 32,
      decoration: BoxDecoration(
        color: color != null ? color.withOpacity(0.12) : Colors.black.withOpacity(0.4),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
            color: color != null ? color.withOpacity(0.45) : AppColors.border),
      ),
      alignment: Alignment.center,
      child: Text(c,
          style: TextStyle(
              fontWeight: bold ? FontWeight.w900 : FontWeight.w800,
              fontSize: 14,
              color: color ?? Colors.white)),
    );
  }

  Widget _statusBadge(bool isWinner, bool isLoser, String drawStatus) {
    if (isWinner) {
      return _badge('WINNER 🏆', AppColors.green, AppColors.green.withOpacity(0.15));
    } else if (isLoser) {
      return _badge('NO WIN', AppColors.textSecondary, AppColors.border.withOpacity(0.4));
    } else if (drawStatus == 'open') {
      return _badge('ACTIVE', AppColors.gold, AppColors.gold.withOpacity(0.1));
    } else {
      return _badge('PENDING', const Color(0xFF2DD4BF), const Color(0xFF00796B).withOpacity(0.15));
    }
  }

  Widget _badge(String label, Color fg, Color bg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3.5),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(6),
      border: Border.all(color: fg.withOpacity(0.35)),
    ),
    child: Text(label, style: TextStyle(color: fg, fontSize: 9, fontWeight: FontWeight.w900, letterSpacing: 0.2)),
  );

  // ── Tab 3: Results ──────────────────────────────────────────────────────

  Widget _resultsTab() {
    if (_resLoading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_results.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.history_rounded,
                size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
            const SizedBox(height: 18),
            const Text('No results yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadResults,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _results.length,
        itemBuilder: (_, i) => _resultCard(_results[i]),
      ),
    );
  }

  Widget _resultCard(dynamic d) {
    final drawTime = DateTime.tryParse(d['draw_time']?.toString() ?? '');
    final winNum = d['winning_number']?.toString() ?? '';
    final winners = int.tryParse(d['winner_count']?.toString() ?? '0') ?? 0;
    final paid = double.tryParse(d['total_paid']?.toString() ?? '0') ?? 0;
    final tickets = int.tryParse(d['total_tickets']?.toString() ?? '0') ?? 0;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.12),
            blurRadius: 10,
            offset: const Offset(0, 4),
          )
        ],
      ),
      child: ClipPath(
        clipper: TicketClipper(punchRadius: 8.0, cutLineYRatio: 0.62),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: AppColors.border.withOpacity(0.8)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Details Area
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 32, height: 32,
                          decoration: BoxDecoration(
                            color: AppColors.green.withOpacity(0.12),
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.green.withOpacity(0.35)),
                          ),
                          child: const Icon(Icons.check_rounded, color: AppColors.green, size: 16),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(d['name'] ?? 'Lottery Draw',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: Colors.white)),
                        ),
                        Text(drawTime != null ? _fmtDt(drawTime) : '',
                            style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 10.5, fontWeight: FontWeight.w600)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (d['winners'] != null && (d['winners'] as List).isNotEmpty) ...[
                      const Row(
                        children: [
                          Icon(Icons.emoji_events_rounded, color: AppColors.gold, size: 14),
                          SizedBox(width: 6),
                          Text('Winning Tickets & Prizes:',
                              style: TextStyle(color: AppColors.goldLight, fontSize: 12.5, fontWeight: FontWeight.bold)),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ...(d['winners'] as List).map<Widget>((w) {
                        return Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.02),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: Colors.white.withOpacity(0.05)),
                          ),
                          child: Row(
                            children: [
                              Text('Ticket: ${w['ticket_number']}',
                                  style: const TextStyle(fontWeight: FontWeight.w800, color: Colors.white, fontSize: 13)),
                              const Spacer(),
                              Text('₹${w['prize']}',
                                  style: const TextStyle(color: AppColors.green, fontWeight: FontWeight.w900, fontSize: 13.5)),
                            ],
                          ),
                        );
                      }).toList(),
                    ] else ...[
                      Row(
                        children: [
                          Text('Winning Number: ',
                              style: TextStyle(color: Colors.white.withOpacity(0.45), fontSize: 12.5, fontWeight: FontWeight.bold)),
                          const SizedBox(width: 6),
                          Text(winNum.isNotEmpty ? winNum : '—',
                              style: const TextStyle(color: AppColors.goldLight, fontWeight: FontWeight.w900, fontSize: 14)),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              // Dashed line divider
              LayoutBuilder(
                builder: (context, constraints) {
                  return CustomPaint(
                    size: Size(constraints.maxWidth, 1),
                    painter: DashedLinePainter(
                      color: Colors.white.withOpacity(0.1),
                      dashWidth: 5.0,
                      dashSpace: 3.0,
                    ),
                  );
                },
              ),

              // Bottom Stats Info area
              Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(Icons.confirmation_num_rounded, size: 13,
                        color: AppColors.textSecondary.withValues(alpha: 0.6)),
                    const SizedBox(width: 4),
                    Text('$tickets tickets sold',
                        style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.7), fontSize: 11, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 14),
                    Icon(Icons.people_alt_rounded, size: 13,
                        color: AppColors.textSecondary.withValues(alpha: 0.6)),
                    const SizedBox(width: 4),
                    Text('$winners winner${winners != 1 ? 's' : ''}',
                        style: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.7), fontSize: 11, fontWeight: FontWeight.w600)),
                    const Spacer(),
                    Text('₹${paid.toStringAsFixed(0)} paid',
                        style: const TextStyle(color: AppColors.green, fontSize: 12, fontWeight: FontWeight.w800)),
                  ],
                ),
              )
            ],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ticket Picker Bottom Sheet
// ─────────────────────────────────────────────────────────────────────────────
class _TicketPickerSheet extends StatefulWidget {
  const _TicketPickerSheet({
    required this.draw,
    required this.digits,
    required this.price,
    required this.balance,
    required this.onPurchased,
  });
  final dynamic draw;
  final int digits;
  final double price;
  final double balance;
  final VoidCallback onPurchased;

  @override
  State<_TicketPickerSheet> createState() => _TicketPickerSheetState();
}

class _TicketPickerSheetState extends State<_TicketPickerSheet> {
  late final TextEditingController _controller;
  bool _submitting = false;
  String? _error;
  List<String> _reserved = [];

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
    final resTickets = widget.draw['reserved_tickets'];
    if (resTickets is List) {
      _reserved = resTickets.map((t) => t.toString().trim().toUpperCase()).toList();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _isReserved => _reserved.contains(_controller.text.trim().toUpperCase());

  Future<void> _submit() async {
    final t = _controller.text.trim().toUpperCase();
    if (t.isEmpty) {
      setState(() => _error = 'Please enter a ticket number');
      return;
    }
    if (!RegExp(r'^[a-zA-Z0-9]+$').hasMatch(t)) {
      setState(() => _error = 'Ticket number must be alphanumeric (letters/numbers only)');
      return;
    }
    if (t.length > widget.digits) {
      setState(() => _error = 'Ticket number cannot exceed ${widget.digits} characters');
      return;
    }
    if (_isReserved) {
      setState(() => _error = 'This ticket number is already reserved');
      return;
    }
    if (widget.price > widget.balance) {
      setState(() => _error = 'Insufficient balance — you have ₹${widget.balance.toStringAsFixed(0)}');
      return;
    }
    
    setState(() { _submitting = true; _error = null; });
    try {
      await ApiClient().dio.post('/api/betting/lottery/buy',
          data: {'draw_id': widget.draw['id'], 'ticket_number': t});
      SoundService.instance.play(Sfx.win);
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      Navigator.pop(context);
      widget.onPurchased();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Ticket "$t" purchased! Good luck 🍀'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ));
    } catch (e) {
      setState(() {
        _submitting = false;
        _error = 'Purchase failed — please try again';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF0D1117),
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        boxShadow: [
          BoxShadow(color: Colors.black54, blurRadius: 20, spreadRadius: 5)
        ]
      ),
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle bar
            Align(
              alignment: Alignment.center,
              child: Container(
                width: 40, height: 4, margin: const EdgeInsets.only(top: 8, bottom: 18),
                decoration: BoxDecoration(
                    color: AppColors.border, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            // Header
            Row(
              children: [
                Container(
                  width: 42, height: 42,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D9488), Color(0xFF064E45)],
                      begin: Alignment.topLeft, end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.confirmation_num_rounded, color: Colors.white, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.draw['name'] ?? 'Lottery Draw',
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: Colors.white)),
                    Text('₹${widget.price.toStringAsFixed(0)} per ticket · Max ${widget.digits} chars',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w600)),
                  ]),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.gold.withOpacity(0.25)),
                  ),
                  child: Column(children: [
                    Text('Balance',
                        style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 9, fontWeight: FontWeight.bold)),
                    Text('₹${widget.balance.toStringAsFixed(0)}',
                        style: const TextStyle(
                            color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 12)),
                  ]),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Divider(color: AppColors.border, height: 1),
            const SizedBox(height: 16),
            
            // Reserved tickets wrap
            if (_reserved.isNotEmpty) ...[
              Row(
                children: [
                  Icon(Icons.remove_circle_outline_rounded, size: 14, color: AppColors.red.withOpacity(0.8)),
                  const SizedBox(width: 5),
                  const Text("Reserved / Sold Ticket Numbers:",
                      style: TextStyle(color: AppColors.red, fontSize: 12, fontWeight: FontWeight.bold)),
                ],
              ),
              const SizedBox(height: 8),
              Container(
                constraints: const BoxConstraints(maxHeight: 90),
                width: double.infinity,
                child: SingleChildScrollView(
                  child: Wrap(
                    spacing: 6, runSpacing: 6,
                    children: _reserved.map<Widget>((ticket) => Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.red.withOpacity(0.08),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: AppColors.red.withOpacity(0.25)),
                      ),
                      child: Text(ticket, style: const TextStyle(color: AppColors.red, fontSize: 10.5, fontWeight: FontWeight.bold)),
                    )).toList(),
                  ),
                ),
              ),
              const SizedBox(height: 18),
            ],

            const Text("Choose Your Ticket Number",
                style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            
            // Input field
            TextField(
              controller: _controller,
              maxLength: widget.digits,
              style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900, letterSpacing: 1.5),
              textCapitalization: TextCapitalization.characters,
              onChanged: (val) {
                setState(() {
                  _error = null;
                });
              },
              decoration: InputDecoration(
                hintText: 'LUCKY7, A12, 10...',
                hintStyle: TextStyle(color: Colors.white.withOpacity(0.2), fontSize: 16, letterSpacing: 0.5),
                filled: true,
                fillColor: Colors.black.withOpacity(0.3),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.border)),
                focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Color(0xFF0D9488), width: 1.8)),
                counterText: '',
                prefixIcon: const Icon(Icons.casino_rounded, color: AppColors.gold, size: 20),
              ),
            ),
            const SizedBox(height: 6),
            const Text("Letters and numbers allowed. Ticket number must be unique in this draw.",
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w500)),

            // Error
            if (_error != null) ...[
              const SizedBox(height: 16),
              Container(
                width: double.infinity, padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.red.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.red.withOpacity(0.3)),
                ),
                child: Row(children: [
                  const Icon(Icons.error_outline_rounded, color: AppColors.red, size: 16),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 12.5, fontWeight: FontWeight.bold))),
                ]),
              ),
            ],
            const SizedBox(height: 24),
            
            // Summary + buy button
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('1 ticket', style: TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
                      Text('₹${widget.price.toStringAsFixed(0)}',
                          style: const TextStyle(
                              fontWeight: FontWeight.w900, fontSize: 20, color: AppColors.goldLight)),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.gold,
                        foregroundColor: Colors.black,
                        disabledBackgroundColor: AppColors.border,
                        disabledForegroundColor: AppColors.textSecondary,
                        minimumSize: const Size.fromHeight(50),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        textStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 15),
                        elevation: 0
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 20, height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.black))
                          : const Text('Confirm Purchase'),
                    ),
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

// ─────────────────────────────────────────────────────────────────────────────
//  Custom Clipper for "Lottery Ticket" Stub Design
// ─────────────────────────────────────────────────────────────────────────────
class TicketClipper extends CustomClipper<Path> {
  final double punchRadius;
  final double cutLineYRatio;
  TicketClipper({this.punchRadius = 10.0, this.cutLineYRatio = 0.7});

  @override
  Path getClip(Size size) {
    final path = Path();
    final cutY = size.height * cutLineYRatio;
    
    // Draw top edge
    path.lineTo(0, 0);
    // Draw left edge with a circular notch at cutY
    path.lineTo(0, cutY - punchRadius);
    path.arcToPoint(
      Offset(0, cutY + punchRadius),
      radius: Radius.circular(punchRadius),
      clockwise: true,
    );
    path.lineTo(0, size.height);
    // Draw bottom edge
    path.lineTo(size.width, size.height);
    // Draw right edge with a circular notch at cutY
    path.lineTo(size.width, cutY + punchRadius);
    path.arcToPoint(
      Offset(size.width, cutY - punchRadius),
      radius: Radius.circular(punchRadius),
      clockwise: true,
    );
    path.lineTo(size.width, 0);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Custom Painter for Dashed Divider Y-axis line
// ─────────────────────────────────────────────────────────────────────────────
class DashedLinePainter extends CustomPainter {
  final Color color;
  final double dashWidth;
  final double dashSpace;
  DashedLinePainter({required this.color, this.dashWidth = 5.0, this.dashSpace = 3.0});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.0
      ..style = PaintingStyle.stroke;
    double startX = 0;
    while (startX < size.width) {
      canvas.drawLine(Offset(startX, 0), Offset(startX + dashWidth, 0), paint);
      startX += dashWidth + dashSpace;
    }
  }

  @override
  bool shouldRepaint(CustomPainter oldDelegate) => false;
}
