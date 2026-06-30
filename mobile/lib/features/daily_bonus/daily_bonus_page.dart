import 'dart:async';
import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

class DailyBonusPage extends StatefulWidget {
  const DailyBonusPage({super.key});
  @override
  State<DailyBonusPage> createState() => _DailyBonusPageState();
}

class _DailyBonusPageState extends State<DailyBonusPage>
    with TickerProviderStateMixin {
  bool _loading = true;
  bool _hasError = false;
  bool _claiming = false;
  Map<String, dynamic>? _data;

  // Countdown to midnight (next claim window)
  Timer? _ticker;
  Duration _untilMidnight = Duration.zero;

  late final AnimationController _pulseCtrl;
  late final AnimationController _celebCtrl;
  late final Animation<double> _celebScale;

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 900))
      ..repeat(reverse: true);
    _celebCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 600));
    _celebScale = CurvedAnimation(parent: _celebCtrl, curve: Curves.elasticOut);
    _updateCountdown();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => _updateCountdown());
    _load();
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _pulseCtrl.dispose();
    _celebCtrl.dispose();
    super.dispose();
  }

  void _updateCountdown() {
    final now = DateTime.now();
    final midnight = DateTime(now.year, now.month, now.day + 1);
    if (mounted) setState(() => _untilMidnight = midnight.difference(now));
  }

  String get _countdownStr {
    final h = _untilMidnight.inHours.toString().padLeft(2, '0');
    final m = (_untilMidnight.inMinutes % 60).toString().padLeft(2, '0');
    final s = (_untilMidnight.inSeconds % 60).toString().padLeft(2, '0');
    return '$h:$m:$s';
  }

  Future<void> _load() async {
    setState(() { _loading = true; _hasError = false; });
    try {
      final res = await ApiClient().dio.get('/api/users/daily-bonus/status');
      if (!mounted) return;
      setState(() { _data = res.data; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _hasError = true; });
    }
  }

  Future<void> _claim() async {
    if (_claiming) return;
    setState(() => _claiming = true);
    try {
      final res = await ApiClient().dio.post('/api/users/daily-bonus/claim', data: {});
      final result = res.data as Map<String, dynamic>;
      if (!mounted) return;
      await _celebCtrl.forward();
      await Future.delayed(const Duration(milliseconds: 200));
      if (mounted) {
        _showCelebration(result);
        await _load();
      }
    } catch (e) {
      if (mounted) {
        final msg = (e as dynamic).response?.data?['error'] ?? 'Could not claim bonus';
        AppSnackBar.show(context, msg, error: true);
      }
    } finally {
      if (mounted) setState(() => _claiming = false);
    }
  }

  void _showCelebration(Map<String, dynamic> result) {
    final emoji = result['emoji'] ?? '🎁';
    final amount = result['bonus_amount'] ?? 0;
    final label = result['label'] ?? 'Daily Bonus';
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (_) => Dialog(
        backgroundColor: Colors.transparent,
        child: ScaleTransition(
          scale: _celebScale,
          child: Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1A4C2E), Color(0xFF0D2E19)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: AppColors.green.withOpacity(0.5), width: 2),
              boxShadow: [BoxShadow(color: AppColors.green.withOpacity(0.3), blurRadius: 40)],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(emoji, style: const TextStyle(fontSize: 64)),
                const SizedBox(height: 12),
                Text('+${formatCurrency(amount)}',
                  style: const TextStyle(
                    color: AppColors.green, fontSize: 36,
                    fontWeight: FontWeight.w900,
                    shadows: [Shadow(color: Color(0x6600C853), blurRadius: 16)],
                  )),
                const SizedBox(height: 6),
                Text(label,
                  style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                const Text('Added to your wallet!',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                const SizedBox(height: 24),
                GestureDetector(
                  onTap: () => Navigator.pop(context),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 12),
                    decoration: BoxDecoration(
                      color: AppColors.green,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Text('Awesome! 🎉',
                      style: TextStyle(color: Colors.black, fontWeight: FontWeight.w900, fontSize: 15)),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool get _canClaim => _data?['can_claim'] == true;
  int get _streak => (_data?['current_streak'] ?? 0) as int;
  int get _longestStreak => (_data?['longest_streak'] ?? 0) as int;
  double get _totalEarned => double.tryParse(_data?['total_earned']?.toString() ?? '0') ?? 0;
  int get _totalClaimed => (_data?['total_claimed'] ?? 0) as int;
  List<dynamic> get _schedule => (_data?['schedule'] as List?) ?? [];
  int get _nextDay => (_data?['next_day_number'] ?? 1) as int;
  Map<String, dynamic> get _todayBonus =>
    (_data?['today_bonus'] as Map?)?.cast<String, dynamic>() ?? {};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Daily Login Bonus'),
        backgroundColor: AppColors.surface,
        leading: const BackButton(color: AppColors.gold),
        actions: [
          if (!_loading)
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
                  child: SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 40),
                    child: Column(
                      children: [
                        _buildStreakHero(),
                        const SizedBox(height: 20),
                        _buildStatsRow(),
                        const SizedBox(height: 24),
                        _buildScheduleGrid(),
                        const SizedBox(height: 24),
                        _buildClaimButton(),
                        const SizedBox(height: 24),
                        _buildHowItWorks(),
                      ],
                    ),
                  ),
                ),
    );
  }

  // ── Streak Hero ───────────────────────────────────────────────────────────────

  Widget _buildStreakHero() => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [Color(0xFF1A3A1A), Color(0xFF0D2010), Color(0xFF0D1117)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(28),
      border: Border.all(color: AppColors.green.withOpacity(0.3), width: 1.5),
      boxShadow: [
        BoxShadow(color: AppColors.green.withOpacity(0.12), blurRadius: 30, offset: const Offset(0, 8)),
      ],
    ),
    child: Stack(
      children: [
        // Glow circle
        Positioned(right: -10, top: -10, child: Container(
          width: 100, height: 100,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.green.withOpacity(0.06),
          ),
        )),
        Column(
          children: [
            Row(
              children: [
                // Streak flame
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppColors.green.withOpacity(0.2), AppColors.green.withOpacity(0.05)],
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                    ),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: AppColors.green.withOpacity(0.4)),
                  ),
                  child: Column(
                    children: [
                      const Text('🔥', style: TextStyle(fontSize: 32)),
                      const SizedBox(height: 4),
                      Text('$_streak',
                        style: const TextStyle(
                          color: AppColors.green, fontSize: 24, fontWeight: FontWeight.w900)),
                      const Text('STREAK',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 9, letterSpacing: 1.5)),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _streak == 0
                          ? 'Start Your Streak!'
                          : _streak < 3
                            ? 'Great Start! 🌱'
                            : _streak < 7
                              ? 'On Fire! 🔥'
                              : 'Unstoppable! ⚡',
                        style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _canClaim
                          ? "Today's bonus: ${_todayBonus['emoji'] ?? '🎁'} ${formatCurrency(_todayBonus['bonus_amount'] ?? 0)}"
                          : 'Come back tomorrow!',
                        style: TextStyle(
                          color: _canClaim ? AppColors.green : AppColors.textSecondary,
                          fontSize: 13, fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 10),
                      // Streak progress bar
                      ClipRRect(
                        borderRadius: BorderRadius.circular(6),
                        child: LinearProgressIndicator(
                          value: (_streak % 7) / 7.0,
                          minHeight: 6,
                          backgroundColor: AppColors.surface,
                          valueColor: const AlwaysStoppedAnimation(AppColors.green),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text('${_streak % 7}/7 days to weekly bonus',
                        style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                    ],
                  ),
                ),
              ],
            ),
            // Countdown row
            if (!_canClaim) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.border),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.timer_outlined, color: AppColors.textSecondary, size: 14),
                    const SizedBox(width: 8),
                    const Text('Next bonus in: ',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                    Text(_countdownStr,
                      style: const TextStyle(
                        color: AppColors.gold, fontSize: 14, fontWeight: FontWeight.w900, letterSpacing: 1)),
                  ],
                ),
              ),
            ],
          ],
        ),
      ],
    ),
  );

  // ── Stats Row ─────────────────────────────────────────────────────────────────

  Widget _buildStatsRow() => Row(
    children: [
      Expanded(child: _statCard('🏆', 'Best Streak', '$_longestStreak days', const Color(0xFF4A2E00), AppColors.gold)),
      const SizedBox(width: 10),
      Expanded(child: _statCard('💰', 'Total Earned', formatCurrency(_totalEarned), const Color(0xFF1A4C2E), AppColors.green)),
      const SizedBox(width: 10),
      Expanded(child: _statCard('📅', 'Days Claimed', '$_totalClaimed', const Color(0xFF1E2A4A), AppColors.blue)),
    ],
  );

  Widget _statCard(String emoji, String label, String value, Color bgColor, Color accent) =>
    Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
      decoration: BoxDecoration(
        color: bgColor.withOpacity(0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: accent.withOpacity(0.3)),
      ),
      child: Column(
        children: [
          Text(emoji, style: const TextStyle(fontSize: 20)),
          const SizedBox(height: 5),
          Text(value, style: TextStyle(color: accent, fontSize: 14, fontWeight: FontWeight.w900)),
          const SizedBox(height: 2),
          Text(label, textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary, fontSize: 10, height: 1.3)),
        ],
      ),
    );

  // ── 7-Day Schedule Grid ───────────────────────────────────────────────────────

  Widget _buildScheduleGrid() => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: AppColors.border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Text('Weekly Schedule', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.gold.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              child: const Text('Resets Weekly',
                style: TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _schedule.isEmpty
          ? _buildDefaultSchedule()
          : Wrap(
              spacing: 8, runSpacing: 10,
              children: _schedule.map((d) => _dayTile(d as Map<String, dynamic>)).toList(),
            ),
      ],
    ),
  );

  Widget _buildDefaultSchedule() => const Center(
    child: Padding(
      padding: EdgeInsets.all(16),
      child: Text('Loading schedule...', style: TextStyle(color: AppColors.textSecondary)),
    ),
  );

  Widget _dayTile(Map<String, dynamic> day) {
    final dayNum = (day['day_number'] as num).toInt();
    final amount = double.tryParse(day['bonus_amount']?.toString() ?? '0') ?? 0;
    final emoji = day['emoji'] as String? ?? '🎁';
    final isSpecial = day['is_special'] == true;
    final claimedDays = _streak;
    final currentDay = _nextDay;

    final isPast = dayNum < currentDay && claimedDays >= dayNum;
    final isToday = dayNum == currentDay && _canClaim;
    final isClaimed = dayNum <= claimedDays && !isToday;

    Color borderColor;
    Color bgColor;
    Color textColor;

    if (isSpecial) {
      borderColor = AppColors.gold;
      bgColor = AppColors.gold.withOpacity(isToday ? 0.25 : isClaimed ? 0.1 : 0.06);
      textColor = AppColors.gold;
    } else if (isClaimed || isPast) {
      borderColor = AppColors.green.withOpacity(0.5);
      bgColor = AppColors.green.withOpacity(0.08);
      textColor = AppColors.green;
    } else if (isToday) {
      borderColor = AppColors.green;
      bgColor = AppColors.green.withOpacity(0.18);
      textColor = AppColors.green;
    } else {
      borderColor = AppColors.border;
      bgColor = AppColors.background;
      textColor = AppColors.textSecondary;
    }

    // Determine tile width for 7-per-row layout
    final screenW = MediaQuery.of(context).size.width;
    final tileW = (screenW - 32 - 20 - 8 * 6) / 7; // 7 tiles with spacing

    return SizedBox(
      width: tileW.clamp(40.0, 60.0),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor, width: isToday ? 2 : 1),
          boxShadow: isToday
            ? [BoxShadow(color: AppColors.green.withOpacity(0.3), blurRadius: 10)]
            : null,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isClaimed || isPast)
              const Icon(Icons.check_circle_rounded, color: AppColors.green, size: 18)
            else
              Text(emoji, style: const TextStyle(fontSize: 16), textAlign: TextAlign.center),
            const SizedBox(height: 4),
            Text(
              amount >= 1000 ? '₹${(amount / 1000).toStringAsFixed(0)}K' : '₹${amount.toInt()}',
              style: TextStyle(color: textColor, fontSize: 10, fontWeight: FontWeight.w900),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 2),
            Text('D$dayNum',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 9),
              textAlign: TextAlign.center),
            if (isToday) ...[
              const SizedBox(height: 3),
              FadeTransition(
                opacity: _pulseCtrl,
                child: Container(
                  width: 6, height: 6,
                  decoration: const BoxDecoration(color: AppColors.green, shape: BoxShape.circle),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // ── Claim Button ──────────────────────────────────────────────────────────────

  Widget _buildClaimButton() {
    final amount = double.tryParse(_todayBonus['bonus_amount']?.toString() ?? '0') ?? 0;
    final emoji = _todayBonus['emoji'] as String? ?? '🎁';
    final label = _todayBonus['label'] as String? ?? 'Daily Bonus';

    return _canClaim
      ? GestureDetector(
          onTap: _claiming ? null : _claim,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 18),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: _claiming
                  ? [AppColors.green.withOpacity(0.5), AppColors.green.withOpacity(0.3)]
                  : [AppColors.green, const Color(0xFF00A046)],
                begin: Alignment.topLeft, end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [BoxShadow(color: AppColors.green.withOpacity(0.45), blurRadius: 20, offset: const Offset(0, 6))],
            ),
            child: _claiming
              ? const Center(child: SizedBox(
                  width: 24, height: 24,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5)))
              : Column(
                  children: [
                    Text('$emoji  Claim ${formatCurrency(amount)}',
                      style: const TextStyle(
                        color: Colors.black, fontSize: 20,
                        fontWeight: FontWeight.w900, letterSpacing: 0.5)),
                    const SizedBox(height: 4),
                    Text(label,
                      style: TextStyle(color: Colors.black.withOpacity(0.6), fontSize: 12)),
                  ],
                ),
          ),
        )
      : Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(vertical: 18),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              const Text('✅  Already Claimed Today',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 16, fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('Next bonus in $_countdownStr',
                style: const TextStyle(color: AppColors.gold, fontSize: 12, fontWeight: FontWeight.w600)),
            ],
          ),
        );
  }

  // ── How It Works ──────────────────────────────────────────────────────────────

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
        const Text('How It Works', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w900)),
        const SizedBox(height: 14),
        _infoRow('📅', 'Login daily to build your streak'),
        const SizedBox(height: 10),
        _infoRow('🔥', 'Each consecutive day gives a bigger reward'),
        const SizedBox(height: 10),
        _infoRow('🏆', 'Day 7 is the weekly jackpot — don\'t miss it!'),
        const SizedBox(height: 10),
        _infoRow('⚠️', 'Missing a day resets your streak to Day 1'),
        const SizedBox(height: 10),
        _infoRow('💰', 'Bonus is credited to your real wallet instantly'),
      ],
    ),
  );

  Widget _infoRow(String emoji, String text) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(emoji, style: const TextStyle(fontSize: 16)),
      const SizedBox(width: 10),
      Expanded(child: Text(text,
        style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4))),
    ],
  );

  // ── Loading / Error ───────────────────────────────────────────────────────────

  Widget _buildShimmer() => Shimmer.fromColors(
    baseColor: AppColors.surface,
    highlightColor: AppColors.cardBg,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(height: 190, decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(28))),
          const SizedBox(height: 16),
          Row(children: List.generate(3, (i) => Expanded(child: Container(
            margin: EdgeInsets.only(left: i > 0 ? 10 : 0),
            height: 80,
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(16)),
          )))),
          const SizedBox(height: 16),
          Container(height: 220, decoration: BoxDecoration(
            color: AppColors.surface, borderRadius: BorderRadius.circular(24))),
          const SizedBox(height: 16),
          Container(height: 70, decoration: BoxDecoration(
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
          const Text('Could not load bonus data',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          const SizedBox(height: 20),
          ElevatedButton(onPressed: _load, child: const Text('Retry')),
        ],
      ),
    ),
  );
}
