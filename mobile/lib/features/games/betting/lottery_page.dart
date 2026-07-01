import 'dart:async';
import 'dart:math';
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
      backgroundColor: const Color(0xFF060D12),
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
      expandedHeight: 230,
      pinned: true,
      backgroundColor: const Color(0xFF060D12),
      leading: BackButton(color: AppColors.gold),
      title: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('🎰', style: TextStyle(fontSize: 18)),
          const SizedBox(width: 6),
          const Text('LOTTERY',
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
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
          decoration: BoxDecoration(
            color: AppColors.gold.withOpacity(0.12),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.gold.withOpacity(0.35)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.account_balance_wallet_rounded, size: 14, color: AppColors.gold),
              const SizedBox(width: 4),
              Text('₹${_balance.toStringAsFixed(0)}',
                  style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(46),
        child: Container(
          color: const Color(0xFF060D12),
          child: TabBar(
            controller: _tab,
            indicatorColor: AppColors.gold,
            indicatorWeight: 2.5,
            labelColor: AppColors.gold,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13),
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
          colors: [Color(0xFF0D9488), Color(0xFF065F52), Color(0xFF060D12)],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: [0.0, 0.5, 1.0],
        ),
      ),
      child: Stack(
        children: [
          // Decorative circles
          Positioned(right: -30, top: -30, child: _glowCircle(140, 0.07)),
          Positioned(left: -20, bottom: 60, child: _glowCircle(90, 0.05)),
          Positioned(right: 50, bottom: 20, child: _glowCircle(60, 0.04)),
          // Gold shimmer top border
          Positioned(
            top: 0, left: 0, right: 0,
            child: Container(
              height: 1.5,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.transparent, AppColors.gold.withOpacity(0.7), Colors.transparent],
                ),
              ),
            ),
          ),
          // Content
          SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 52, 20, 50),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'JACKPOT PRIZE',
                    style: TextStyle(
                        color: Colors.white.withOpacity(0.65),
                        fontSize: 11,
                        letterSpacing: 4,
                        fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  TweenAnimationBuilder<double>(
                    key: ValueKey(jackpot),
                    tween: Tween(begin: jackpot * 0.7, end: jackpot),
                    duration: const Duration(milliseconds: 1400),
                    curve: Curves.easeOutCubic,
                    builder: (_, v, __) => Text(
                      jackpot == 0 ? 'No Active Draws' : _fmtCurrency(v),
                      style: TextStyle(
                        fontSize: jackpot == 0 ? 22 : 46,
                        fontWeight: FontWeight.w900,
                        color: AppColors.goldLight,
                        letterSpacing: -1,
                        shadows: const [Shadow(color: Color(0xFFFFD700), blurRadius: 30)],
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  if (next != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.black.withOpacity(0.3),
                        borderRadius: BorderRadius.circular(30),
                        border: Border.all(color: AppColors.gold.withOpacity(0.3)),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.timer_rounded, color: AppColors.textSecondary, size: 14),
                          const SizedBox(width: 6),
                          Text('Next draw in ',
                              style: TextStyle(color: Colors.white.withOpacity(0.55), fontSize: 12)),
                          Text(
                            _countdown(next),
                            style: const TextStyle(
                                color: AppColors.goldLight,
                                fontWeight: FontWeight.w900,
                                fontSize: 15),
                          ),
                        ],
                      ),
                    )
                  else
                    Text('No upcoming draws',
                        style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 13)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _glowCircle(double size, double opacity) => Container(
    width: size, height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: Colors.white.withOpacity(opacity),
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
                size: 64, color: AppColors.textSecondary.withOpacity(0.35)),
            const SizedBox(height: 18),
            const Text('No draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text('Check back soon for new jackpots',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.55), fontSize: 13)),
            const SizedBox(height: 20),
            TextButton.icon(
              onPressed: _loadDraws,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(foregroundColor: AppColors.gold),
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
        border: Border.all(
            color: isExpired ? AppColors.border : AppColors.gold.withOpacity(0.25)),
        boxShadow: isExpired
            ? []
            : [BoxShadow(color: const Color(0xFF0D9488).withOpacity(0.18), blurRadius: 24, offset: const Offset(0, 8))],
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
                        ? [const Color(0xFF1A1F2B), const Color(0xFF0D1117)]
                        : [const Color(0xFF0F6B62), const Color(0xFF07423C), const Color(0xFF021F1C)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
            ),
            // Gold top shimmer
            if (!isExpired)
              Positioned(
                top: 0, left: 0, right: 0,
                child: Container(
                  height: 1,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [Colors.transparent, AppColors.gold.withOpacity(0.5), Colors.transparent],
                    ),
                  ),
                ),
              ),
            // Decorative circles
            Positioned(right: -25, top: -25, child: _glowCircle(110, 0.07)),
            Positioned(right: 40, bottom: -20, child: _glowCircle(70, 0.04)),
            // Card content
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header row
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
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
                              fontWeight: FontWeight.w800,
                              letterSpacing: 1.2),
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(d['name'] ?? 'Lottery Draw',
                            style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w900,
                                color: Colors.white)),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withOpacity(0.25),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text('$digits digits',
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 11)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // Stats row
                  Row(
                    children: [
                      _statChip('JACKPOT', _fmtCurrency(maxPrize), AppColors.goldLight),
                      const SizedBox(width: 10),
                      _statChip('TICKET', '₹${price.toStringAsFixed(0)}', Colors.white),
                      const SizedBox(width: 10),
                      _statChip('SOLD', '$ticketCount', const Color(0xFF5EEAD4)),
                    ],
                  ),
                  const SizedBox(height: 14),
                  // Countdown
                  Row(
                    children: [
                      Icon(
                        isExpired ? Icons.timelapse_rounded : Icons.timer_outlined,
                        size: 13,
                        color: isExpired ? AppColors.orange : AppColors.textSecondary,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        isExpired ? 'Draw in progress!' : 'Closes in ${_countdown(drawTime)}',
                        style: TextStyle(
                            color: isExpired ? AppColors.orange : AppColors.textSecondary,
                            fontSize: 12,
                            fontWeight: isExpired ? FontWeight.w700 : FontWeight.normal),
                      ),
                      if (drawTime != null && !isExpired) ...[
                        const Spacer(),
                        Text(_fmtDt(drawTime),
                            style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                      ],
                    ],
                  ),
                  const SizedBox(height: 8),
                  // Time progress bar
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: isExpired ? 1.0 : progress,
                      backgroundColor: Colors.white.withOpacity(0.08),
                      valueColor: AlwaysStoppedAnimation(
                        isExpired ? AppColors.orange : AppColors.gold),
                      minHeight: 3,
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Buy button
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: isExpired ? null : () {
                        SoundService.instance.play(Sfx.buttonTap);
                        _showTicketPicker(d, digits, price);
                      },
                      icon: const Icon(Icons.confirmation_num_rounded, size: 18),
                      label: const Text('Buy Ticket'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.gold,
                        foregroundColor: Colors.black,
                        disabledBackgroundColor: AppColors.border.withOpacity(0.5),
                        disabledForegroundColor: AppColors.textSecondary,
                        minimumSize: const Size.fromHeight(50),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
                      ),
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

  Widget _statChip(String label, String value, Color color) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 6),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.28),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          children: [
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 9, fontWeight: FontWeight.w700, letterSpacing: 0.8)),
            const SizedBox(height: 4),
            Text(value, style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.w900)),
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
          if (_tab.index == 1) _loadMyTickets();
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
                size: 64, color: AppColors.textSecondary.withOpacity(0.35)),
            const SizedBox(height: 18),
            const Text('No tickets yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 6),
            Text('Buy a ticket from Active Draws',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.55), fontSize: 13)),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: () => _tab.animateTo(0),
              icon: const Icon(Icons.confirmation_num_rounded, size: 16),
              label: const Text('See Active Draws'),
              style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0D9488),
                  foregroundColor: Colors.white),
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
        color: isWinner
            ? AppColors.green.withOpacity(0.07)
            : AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isWinner
              ? AppColors.green.withOpacity(0.4)
              : isLoser
                  ? AppColors.border.withOpacity(0.5)
                  : AppColors.gold.withOpacity(0.2),
          width: isWinner ? 1.5 : 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(t['draw_name'] ?? 'Lottery',
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                ),
                _statusBadge(isWinner, isLoser, drawStatus),
              ],
            ),
            const SizedBox(height: 12),
            // Digit display
            Row(
              children: [
                Text('Your pick  ',
                    style: TextStyle(color: AppColors.textSecondary.withOpacity(0.7), fontSize: 12)),
                ...ticketNum.split('').map((c) => _digitDisplay(c, isWinner ? AppColors.green : null)),
              ],
            ),
            // Winning number (if settled)
            if (winNum != null && drawStatus == 'settled') ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Text('Winning   ',
                      style: TextStyle(color: AppColors.textSecondary.withOpacity(0.7), fontSize: 12)),
                  ...winNum.split('').map((c) => _digitDisplay(c, AppColors.goldLight, bold: true)),
                ],
              ),
            ],
            if (isWinner && prize > 0) ...[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.green.withOpacity(0.3)),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.emoji_events_rounded, color: AppColors.green, size: 18),
                    const SizedBox(width: 8),
                    Text('You Won ₹${prize.toStringAsFixed(2)}!',
                        style: const TextStyle(
                            color: AppColors.green, fontWeight: FontWeight.w800, fontSize: 14)),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 8),
            if (drawTime != null)
              Text('Draw: ${_fmtDt(drawTime)}',
                  style: TextStyle(color: AppColors.textSecondary.withOpacity(0.55), fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Widget _digitDisplay(String c, Color? color, {bool bold = false}) {
    return Container(
      margin: const EdgeInsets.only(right: 5),
      width: 28, height: 34,
      decoration: BoxDecoration(
        color: color != null ? color.withOpacity(0.12) : Colors.black.withOpacity(0.35),
        borderRadius: BorderRadius.circular(7),
        border: Border.all(
            color: color != null ? color.withOpacity(0.45) : AppColors.border),
      ),
      alignment: Alignment.center,
      child: Text(c,
          style: TextStyle(
              fontWeight: bold ? FontWeight.w900 : FontWeight.w800,
              fontSize: 15,
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
      return _badge('PENDING', const Color(0xFF5EEAD4), const Color(0xFF0D9488).withOpacity(0.15));
    }
  }

  Widget _badge(String label, Color fg, Color bg) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(7),
      border: Border.all(color: fg.withOpacity(0.35)),
    ),
    child: Text(label, style: TextStyle(color: fg, fontSize: 10, fontWeight: FontWeight.w800)),
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
                size: 64, color: AppColors.textSecondary.withOpacity(0.35)),
            const SizedBox(height: 18),
            const Text('No results yet',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.w600)),
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
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border.withOpacity(0.7)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
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
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
                ),
                Text(drawTime != null ? _fmtDt(drawTime) : '',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              ],
            ),
            const SizedBox(height: 16),
            // Winning number tiles
            Row(
              children: [
                Text('Winning Number  ',
                    style: TextStyle(color: AppColors.textSecondary.withOpacity(0.7), fontSize: 12)),
                ...winNum.split('').map((c) => Container(
                  margin: const EdgeInsets.only(right: 6),
                  width: 34, height: 40,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D9488), Color(0xFF064E45)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                    borderRadius: BorderRadius.circular(9),
                    border: Border.all(color: AppColors.gold.withOpacity(0.45)),
                    boxShadow: [BoxShadow(color: const Color(0xFF0D9488).withOpacity(0.35), blurRadius: 8)],
                  ),
                  alignment: Alignment.center,
                  child: Text(c,
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 18, color: AppColors.goldLight)),
                )),
              ],
            ),
            const SizedBox(height: 14),
            // Stats
            Row(
              children: [
                Icon(Icons.confirmation_num_rounded, size: 13,
                    color: AppColors.textSecondary.withOpacity(0.6)),
                const SizedBox(width: 4),
                Text('$tickets tickets sold',
                    style: TextStyle(color: AppColors.textSecondary.withOpacity(0.7), fontSize: 12)),
                const SizedBox(width: 14),
                Icon(Icons.people_alt_rounded, size: 13,
                    color: AppColors.textSecondary.withOpacity(0.6)),
                const SizedBox(width: 4),
                Text('$winners winner${winners == 1 ? '' : 's'}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                if (paid > 0) ...[
                  const SizedBox(width: 14),
                  const Icon(Icons.payments_rounded, size: 13, color: AppColors.green),
                  const SizedBox(width: 4),
                  Text(_fmtCurrency(paid),
                      style: const TextStyle(
                          color: AppColors.green, fontSize: 12, fontWeight: FontWeight.w700)),
                ],
              ],
            ),
          ],
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
  final List<List<TextEditingController>> _tickets = [];
  final List<List<FocusNode>> _ticketNodes = [];
  int _activeTicket = 0;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _addTicket();
  }

  @override
  void dispose() {
    for (final row in _tickets) { for (final c in row) c.dispose(); }
    for (final row in _ticketNodes) { for (final n in row) n.dispose(); }
    super.dispose();
  }

  void _onFocusChange() { if (mounted) setState(() {}); }

  void _addTicket() {
    final ctrls = List.generate(widget.digits, (_) => TextEditingController());
    final nodes = List.generate(widget.digits, (_) => FocusNode()..addListener(_onFocusChange));
    setState(() {
      _tickets.add(ctrls);
      _ticketNodes.add(nodes);
      _activeTicket = _tickets.length - 1;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _ticketNodes.isNotEmpty) _ticketNodes.last[0].requestFocus();
    });
  }

  void _removeTicket(int idx) {
    if (_tickets.length <= 1) return;
    for (final c in _tickets[idx]) c.dispose();
    for (final n in _ticketNodes[idx]) n.dispose();
    setState(() {
      _tickets.removeAt(idx);
      _ticketNodes.removeAt(idx);
      _activeTicket = _activeTicket.clamp(0, _tickets.length - 1);
    });
  }

  void _luckyDip(int ti) {
    final rng = Random();
    for (final c in _tickets[ti]) c.text = rng.nextInt(10).toString();
    setState(() {});
    HapticFeedback.mediumImpact();
    SoundService.instance.play(Sfx.buttonTap);
  }

  String _num(int ti) => _tickets[ti].map((c) => c.text).join();

  bool _valid(int ti) {
    final n = _num(ti);
    return n.length == widget.digits && RegExp(r'^\d+$').hasMatch(n);
  }

  bool get _allValid => List.generate(_tickets.length, (i) => i).every(_valid);

  double get _totalCost => widget.price * _tickets.length;

  Future<void> _submit() async {
    if (!_allValid) {
      setState(() => _error = 'Fill all digits for each ticket');
      return;
    }
    if (_totalCost > widget.balance) {
      setState(() => _error =
          'Insufficient balance — you have ₹${widget.balance.toStringAsFixed(0)}');
      return;
    }
    setState(() { _submitting = true; _error = null; });
    int bought = 0;
    try {
      for (var i = 0; i < _tickets.length; i++) {
        await ApiClient().dio.post('/api/betting/lottery/buy',
            data: {'draw_id': widget.draw['id'], 'ticket_number': _num(i)});
        bought++;
      }
      SoundService.instance.play(Sfx.win);
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      Navigator.pop(context);
      widget.onPurchased();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(bought == 1
            ? 'Ticket purchased! Good luck 🍀'
            : '$bought tickets purchased! Good luck 🍀'),
        backgroundColor: AppColors.green,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ));
    } catch (e) {
      setState(() {
        _submitting = false;
        _error = e.toString().contains('Insufficient')
            ? 'Insufficient balance'
            : 'Purchase failed — please try again';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF0D1117),
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      padding: EdgeInsets.only(
        left: 20, right: 20, top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Container(
              width: 40, height: 4, margin: const EdgeInsets.only(top: 8, bottom: 18),
              decoration: BoxDecoration(
                  color: AppColors.border, borderRadius: BorderRadius.circular(2)),
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
                  child: const Icon(Icons.confirmation_num_rounded, color: Colors.white, size: 22),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.draw['name'] ?? 'Lottery Draw',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                    Text('₹${widget.price.toStringAsFixed(0)} per ticket · ${widget.digits}-digit number',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  ]),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: AppColors.gold.withOpacity(0.3)),
                  ),
                  child: Column(children: [
                    Text('Balance',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 9)),
                    Text('₹${widget.balance.toStringAsFixed(0)}',
                        style: const TextStyle(
                            color: AppColors.gold, fontWeight: FontWeight.bold, fontSize: 13)),
                  ]),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Divider(color: AppColors.border, height: 1),
            const SizedBox(height: 16),
            // Ticket entries
            ..._tickets.asMap().entries.map((e) => _ticketEntry(e.key)),
            // Add ticket
            if (_tickets.length < 5)
              TextButton.icon(
                onPressed: _addTicket,
                icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
                label: const Text('Add another ticket'),
                style: TextButton.styleFrom(foregroundColor: const Color(0xFF5EEAD4)),
              ),
            // Error
            if (_error != null) ...[
              const SizedBox(height: 8),
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
                  Expanded(child: Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 13))),
                ]),
              ),
            ],
            const SizedBox(height: 18),
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
                  Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(
                      '${_tickets.length} ticket${_tickets.length > 1 ? 's' : ''}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                    ),
                    Text('₹${_totalCost.toStringAsFixed(0)}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w900, fontSize: 22, color: AppColors.goldLight)),
                  ]),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.gold,
                        foregroundColor: Colors.black,
                        minimumSize: const Size.fromHeight(52),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        textStyle: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                      ),
                      child: _submitting
                          ? const SizedBox(
                              width: 22, height: 22,
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

  Widget _ticketEntry(int ti) {
    final isActive = _activeTicket == ti;
    return GestureDetector(
      onTap: () {
        setState(() => _activeTicket = ti);
        _ticketNodes[ti][0].requestFocus();
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.only(bottom: 14),
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
        decoration: BoxDecoration(
          color: isActive
              ? const Color(0xFF0D9488).withOpacity(0.06)
              : AppColors.cardBg.withOpacity(0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: isActive
                ? const Color(0xFF0D9488).withOpacity(0.5)
                : AppColors.border.withOpacity(0.6),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 26, height: 26,
                  decoration: BoxDecoration(
                    color: isActive
                        ? const Color(0xFF0D9488).withOpacity(0.2)
                        : AppColors.gold.withOpacity(0.12),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text('${ti + 1}',
                      style: TextStyle(
                          color: isActive ? const Color(0xFF5EEAD4) : AppColors.gold,
                          fontSize: 11, fontWeight: FontWeight.w800)),
                ),
                const SizedBox(width: 8),
                Text('Ticket ${ti + 1}',
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                const Spacer(),
                TextButton.icon(
                  onPressed: () => _luckyDip(ti),
                  icon: const Icon(Icons.casino_rounded, size: 14),
                  label: const Text('Lucky Dip', style: TextStyle(fontSize: 12)),
                  style: TextButton.styleFrom(
                      foregroundColor: AppColors.textSecondary,
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                ),
                if (_tickets.length > 1) ...[
                  const SizedBox(width: 4),
                  GestureDetector(
                    onTap: () => _removeTicket(ti),
                    child: Icon(Icons.close_rounded, size: 18, color: AppColors.red.withOpacity(0.7)),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 14),
            // Digit boxes row
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(widget.digits, (di) => _digitBox(ti, di)),
            ),
          ],
        ),
      ),
    );
  }

  Widget _digitBox(int ti, int di) {
    final ctrl = _tickets[ti][di];
    final node = _ticketNodes[ti][di];
    final focused = node.hasFocus;
    final filled = ctrl.text.isNotEmpty;
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 3),
        height: 56,
        decoration: BoxDecoration(
          color: focused
              ? const Color(0xFF0D9488).withOpacity(0.12)
              : filled
                  ? Colors.black.withOpacity(0.45)
                  : AppColors.cardBg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: focused
                ? const Color(0xFF0D9488)
                : filled
                    ? AppColors.gold.withOpacity(0.45)
                    : AppColors.border,
            width: focused ? 2 : 1,
          ),
        ),
        child: TextField(
          controller: ctrl,
          focusNode: node,
          textAlign: TextAlign.center,
          keyboardType: TextInputType.number,
          maxLength: 1,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white),
          decoration: const InputDecoration(
            border: InputBorder.none,
            counterText: '',
            contentPadding: EdgeInsets.zero,
          ),
          onChanged: (v) {
            if (v.length > 1) ctrl.text = v[v.length - 1];
            if (v.isEmpty) {
              if (di > 0) _ticketNodes[ti][di - 1].requestFocus();
            } else {
              if (di < widget.digits - 1) {
                _ticketNodes[ti][di + 1].requestFocus();
              } else if (ti < _tickets.length - 1) {
                _ticketNodes[ti + 1][0].requestFocus();
                setState(() => _activeTicket = ti + 1);
              }
            }
            setState(() {});
          },
        ),
      ),
    );
  }
}
