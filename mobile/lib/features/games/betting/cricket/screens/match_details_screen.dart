import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../../core/audio/sound_service.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_api.dart';
import '../data/cricket_models.dart';
import '../widgets/bet_slip_helper.dart';
import '../widgets/sport_helper.dart';

class MatchDetailsScreen extends StatefulWidget {
  final CricketMatch match;
  const MatchDetailsScreen({super.key, required this.match});

  @override
  State<MatchDetailsScreen> createState() => _MatchDetailsScreenState();
}

class _MatchDetailsScreenState extends State<MatchDetailsScreen> with SingleTickerProviderStateMixin {
  final _api = CricketApi();
  late CricketMatch _match;
  List<SessionMarket> _sessions = [];
  List<OddsBetRecord> _myBets = [];
  bool _loading = true;
  bool _loadingBets = false;
  Timer? _refreshTimer;
  late TabController _tabController;

  @override
  void initState() {
    super.initState();
    _match = widget.match;
    final isCricket = SportHelper.getCategory(_match.format) == 'Cricket';
    _tabController = TabController(length: isCricket ? 4 : 3, vsync: this);
    _loadMatchDetails();
    _loadMyBets();
    _refreshTimer = Timer.periodic(const Duration(seconds: 15), (_) => _loadMatchDetails(silent: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadMatchDetails({bool silent = false}) async {
    if (!silent) setState(() => _loading = true);
    try {
      final liveData = await _api.fetchLiveMatch(_match);
      if (mounted) {
        setState(() {
          _match = liveData.match;
          _sessions = liveData.sessions;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMyBets() async {
    setState(() => _loadingBets = true);
    try {
      final allBets = await _api.fetchOddsBetHistory();
      if (mounted) {
        setState(() {
          _myBets = allBets.where((b) =>
            b.teamA.toLowerCase() == _match.teamA.toLowerCase() ||
            b.teamB.toLowerCase() == _match.teamB.toLowerCase() ||
            b.teamA.toLowerCase() == _match.teamAShort.toLowerCase()
          ).toList();
          _loadingBets = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingBets = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sportCat = SportHelper.getCategory(_match.format);
    final sportDef = SportHelper.popularSports.firstWhere(
      (s) => s.name.toLowerCase() == sportCat.toLowerCase(),
      orElse: () => SportHelper.popularSports[0],
    );
    final isLive = _match.isLive;
    final isCricket = sportCat == 'Cricket';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // ── Top Header Bar ──
            _buildTopAppBar(sportCat, sportDef),

            // ── Main Scrollable View ──
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  await _loadMatchDetails();
                  await _loadMyBets();
                },
                color: AppColors.gold,
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  children: [
                    // ── Stadium & Live Scoreboard Hero Card ──
                    _buildHeroScoreboardCard(sportCat, sportDef, isLive),
                    const SizedBox(height: 14),

                    // ── Live TV / Stream Banner if available ──
                    if (_match.liveTvUrl != null && _match.liveTvUrl!.isNotEmpty) ...[
                      _buildLiveTvBanner(),
                      const SizedBox(height: 14),
                    ],

                    // ── Interactive Category Tabs ──
                    _buildSubTabBar(isCricket),
                    const SizedBox(height: 14),

                    // ── Active Tab View ──
                    SizedBox(
                      height: 520,
                      child: TabBarView(
                        controller: _tabController,
                        children: [
                          // Tab 1: Odds & Markets
                          _buildMarketsTab(sportCat),

                          // Tab 2: Sessions / In-Play (Only if Cricket)
                          if (isCricket) _buildSessionsTab(),

                          // Tab 3: Match Stats & H2H
                          _buildStatsTab(sportCat),

                          // Tab 4: My Bets
                          _buildMyBetsTab(),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Top App Bar ──
  Widget _buildTopAppBar(String sportCat, SportDef sportDef) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: Colors.white10)),
      ),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 20),
            onPressed: () => Navigator.pop(context),
          ),
          const SizedBox(width: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: sportDef.gradient),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: sportDef.accent.withValues(alpha: 0.5)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(sportDef.icon, style: const TextStyle(fontSize: 14)),
                const SizedBox(width: 6),
                Text(
                  sportCat.toUpperCase(),
                  style: TextStyle(color: sportDef.accent, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _match.series,
              style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            icon: _loading
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.gold))
                : const Icon(Icons.refresh_rounded, color: Colors.white70, size: 22),
            onPressed: () => _loadMatchDetails(),
          ),
        ],
      ),
    );
  }

  // ── Hero Scoreboard Card ──
  Widget _buildHeroScoreboardCard(String sportCat, SportDef sportDef, bool isLive) {
    final score = _match.liveScore;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            sportDef.gradient[0],
            sportDef.gradient.length > 1 ? sportDef.gradient[1] : const Color(0xFF1E293B),
            const Color(0xFF0F172A),
          ],
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: isLive ? AppColors.red.withValues(alpha: 0.6) : sportDef.accent.withValues(alpha: 0.35),
          width: isLive ? 1.5 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: (isLive ? AppColors.red : sportDef.accent).withValues(alpha: 0.15),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        children: [
          // Series & Status Header
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _match.format.toUpperCase(),
                style: TextStyle(color: sportDef.accent, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.5),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: isLive ? AppColors.red : AppColors.pitchGreen.withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: isLive ? Colors.white24 : AppColors.pitchGreenLight),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isLive) ...[
                      Container(width: 6, height: 6, decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle)),
                      const SizedBox(width: 5),
                    ],
                    Text(
                      isLive ? 'LIVE IN-PLAY' : 'UPCOMING',
                      style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // Teams & Score Center
          Row(
            children: [
              // Team A
              Expanded(
                flex: 4,
                child: Column(
                  children: [
                    _buildTeamAvatar(_match.teamA, _match.teamAShort, _match.teamAFlag, sportDef.accent),
                    const SizedBox(height: 8),
                    Text(
                      _match.teamA,
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      _match.teamAShort,
                      style: const TextStyle(color: Colors.white60, fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),

              // Score / VS Center
              Expanded(
                flex: 5,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _buildSportScoreCenter(sportCat, score, isLive),
                    const SizedBox(height: 6),
                    if (!isLive && _match.startTime.isNotEmpty)
                      _buildUpcomingCountdown()
                    else if (isLive)
                      _buildLiveTimeBadge(sportCat, score),
                  ],
                ),
              ),

              // Team B
              Expanded(
                flex: 4,
                child: Column(
                  children: [
                    _buildTeamAvatar(_match.teamB, _match.teamBShort, _match.teamBFlag, sportDef.accent),
                    const SizedBox(height: 8),
                    Text(
                      _match.teamB,
                      style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      _match.teamBShort,
                      style: const TextStyle(color: Colors.white60, fontSize: 11, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ),

          // Commentary / Match Description Banner
          if (score.description != null && score.description!.isNotEmpty) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: Colors.white10),
              ),
              child: Row(
                children: [
                  const Icon(Icons.bolt_rounded, color: AppColors.gold, size: 16),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      score.description!,
                      style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── Sport-Specific Center Score ──
  Widget _buildSportScoreCenter(String sportCat, LiveScore score, bool isLive) {
    if (!isLive) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Text('VS', style: TextStyle(color: AppColors.gold, fontSize: 18, fontWeight: FontWeight.w900)),
      );
    }

    if (sportCat == 'Cricket') {
      return Column(
        children: [
          Text(
            score.hasScore ? '${score.runs}/${score.wickets}' : '0/0',
            style: const TextStyle(color: AppColors.gold, fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: -0.5),
          ),
          if (score.overs != null)
            Text('(${score.overs} ov)', style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      );
    }

    if (sportCat == 'Football' || sportCat == 'Soccer') {
      final gA = score.goalsA ?? score.runs ?? 0;
      final gB = score.goalsB ?? score.wickets ?? 0;
      return Column(
        children: [
          Text(
            '$gA - $gB',
            style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w900, letterSpacing: 2),
          ),
          if (score.matchTime != null)
            Text(score.matchTime!, style: const TextStyle(color: AppColors.gold, fontSize: 12, fontWeight: FontWeight.bold)),
        ],
      );
    }

    if (sportCat == 'Basketball') {
      final pA = score.pointsA ?? 98;
      final pB = score.pointsB ?? 94;
      return Column(
        children: [
          Text(
            '$pA - $pB',
            style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900),
          ),
          if (score.quarter != null)
            Text(score.quarter!, style: const TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
        ],
      );
    }

    if (sportCat == 'Tennis') {
      return Column(
        children: [
          Text(
            score.sets ?? '1 - 0',
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900),
          ),
          if (score.gamePoint != null)
            Text('Game: ${score.gamePoint}', style: const TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
        ],
      );
    }

    if (sportCat == 'Combat Sports') {
      return Column(
        children: [
          Text(
            score.round ?? 'Round 3',
            style: const TextStyle(color: AppColors.gold, fontSize: 18, fontWeight: FontWeight.w900),
          ),
          const Text('UFC Main Card', style: TextStyle(color: Colors.white60, fontSize: 10)),
        ],
      );
    }

    return const Text('LIVE', style: TextStyle(color: AppColors.gold, fontSize: 20, fontWeight: FontWeight.w900));
  }

  Widget _buildLiveTimeBadge(String sportCat, LiveScore score) {
    String text = 'In Play';
    if (sportCat == 'Cricket' && score.overs != null) text = 'Over ${score.overs}';
    if (sportCat == 'Football' && score.matchTime != null) text = score.matchTime!;
    if (sportCat == 'Basketball' && score.quarter != null) text = score.quarter!;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black38,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(text, style: const TextStyle(color: Colors.white70, fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }

  Widget _buildUpcomingCountdown() {
    final dt = DateTime.tryParse(_match.startTime);
    String timeStr = 'Today';
    if (dt != null) {
      final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final ampm = dt.hour >= 12 ? 'PM' : 'AM';
      final min = dt.minute.toString().padLeft(2, '0');
      timeStr = '${dt.day}/${dt.month} $hour:$min $ampm';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.black38,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        timeStr,
        style: const TextStyle(color: AppColors.pitchGreenLight, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildTeamAvatar(String name, String shortName, String? flagUrl, Color accent) {
    if (flagUrl != null && flagUrl.startsWith('http')) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Image.network(
          flagUrl,
          width: 48,
          height: 48,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => _buildInitialsBadge(shortName, accent),
        ),
      );
    }
    return _buildInitialsBadge(shortName, accent);
  }

  Widget _buildInitialsBadge(String shortName, Color accent) {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [accent.withValues(alpha: 0.3), Colors.white.withValues(alpha: 0.1)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: accent.withValues(alpha: 0.6), width: 1.5),
      ),
      child: Center(
        child: Text(
          shortName.length > 3 ? shortName.substring(0, 3) : shortName,
          style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w900),
        ),
      ),
    );
  }

  // ── Live TV Video Banner ──
  Widget _buildLiveTvBanner() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.red.withValues(alpha: 0.5)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.red.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.live_tv_rounded, color: AppColors.red, size: 20),
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Live Video Stream Available', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                Text('Watch instant match stream & in-play visuals', style: TextStyle(color: AppColors.textSecondary, fontSize: 10)),
              ],
            ),
          ),
          ElevatedButton(
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                content: Text('Connecting to low-latency sports feed... 📺'),
                backgroundColor: AppColors.pitchGreen,
              ));
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.red,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('Watch TV', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // ── Sub-Tab Bar ──
  Widget _buildSubTabBar(bool isCricket) {
    return Container(
      height: 42,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: TabBar(
        controller: _tabController,
        indicator: BoxDecoration(
          color: AppColors.gold,
          borderRadius: BorderRadius.circular(10),
        ),
        labelColor: Colors.black,
        unselectedLabelColor: Colors.white70,
        labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
        unselectedLabelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        dividerColor: Colors.transparent,
        tabs: [
          const Tab(text: '🎯 Odds & Markets'),
          if (isCricket) const Tab(text: '⚡ Sessions'),
          const Tab(text: '📊 Match Info & H2H'),
          Tab(text: '🎟️ My Bets (${_myBets.length})'),
        ],
      ),
    );
  }

  // ── Tab 1: Odds & Markets ──
  Widget _buildMarketsTab(String sportCat) {
    List<OddsMarket> markets = _match.markets;

    // Fallback markets if match has none yet
    if (markets.isEmpty) {
      markets = [
        OddsMarket(
          id: 'gen_1',
          matchId: _match.id,
          marketType: sportCat == 'Football' ? '1x2' : 'match_winner',
          label: sportCat == 'Football' ? 'Full Time Result (1X2)' : 'Match Winner',
          status: 'open',
          options: [
            OddsMarketOption(key: 'team_a', label: _match.teamA, odds: 1.85),
            if (sportCat == 'Football') OddsMarketOption(key: 'draw', label: 'Draw', odds: 3.30),
            OddsMarketOption(key: 'team_b', label: _match.teamB, odds: 1.95),
          ],
        ),
        OddsMarket(
          id: 'gen_2',
          matchId: _match.id,
          marketType: 'totals',
          label: sportCat == 'Football' ? 'Total Goals Over / Under 2.5' : (sportCat == 'Cricket' ? 'Total Match Runs Over / Under 320' : 'Total Points Over / Under'),
          status: 'open',
          options: const [
            OddsMarketOption(key: 'over', label: 'Over', odds: 1.90),
            OddsMarketOption(key: 'under', label: 'Under', odds: 1.90),
          ],
        ),
        if (sportCat == 'Football')
          const OddsMarket(
            id: 'gen_3',
            matchId: 'gen_3',
            marketType: 'btts',
            label: 'Both Teams To Score (BTTS)',
            status: 'open',
            options: [
              OddsMarketOption(key: 'yes', label: 'Yes', odds: 1.75),
              OddsMarketOption(key: 'no', label: 'No', odds: 2.05),
            ],
          ),
      ];
    }

    return ListView(
      physics: const BouncingScrollPhysics(),
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Available Decimal Odds (${markets.length} Markets)',
              style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold),
            ),
            const Text(
              'Payout = Stake × Multiplier',
              style: TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        const SizedBox(height: 10),
        ...markets.map((mkt) => _buildMarketCard(mkt)),
      ],
    );
  }

  Widget _buildMarketCard(OddsMarket market) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    width: 4,
                    height: 14,
                    decoration: BoxDecoration(color: AppColors.gold, borderRadius: BorderRadius.circular(2)),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    market.label,
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.pitchGreen.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Text('ACTIVE', style: TextStyle(color: AppColors.pitchGreenLight, fontSize: 9, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Odds Options Grid / Row
          Row(
            children: market.options.map((opt) {
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: InkWell(
                    onTap: () {
                      SoundService.instance.play(Sfx.buttonTap);
                      BetSlipHelper.showPlaceBetDialog(context, _match, market, opt);
                    },
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppColors.gold.withValues(alpha: 0.4), width: 1.0),
                        boxShadow: [
                          BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 4, offset: const Offset(0, 2)),
                        ],
                      ),
                      child: Column(
                        children: [
                          Text(
                            opt.label,
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.gold.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '${opt.odds.toStringAsFixed(2)}x',
                              style: const TextStyle(color: AppColors.gold, fontSize: 14, fontWeight: FontWeight.w900),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  // ── Tab 2: Sessions / In-Play ──
  Widget _buildSessionsTab() {
    if (_sessions.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.timer_outlined, color: Colors.white30, size: 40),
            const SizedBox(height: 10),
            const Text('No Live Over Brackets Open', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(
              'Session bets open automatically during in-play overs for ${_match.teamAShort} vs ${_match.teamBShort}.',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      itemCount: _sessions.length,
      itemBuilder: (context, idx) {
        final session = _sessions[idx];
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(session.label, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => _placeSessionBet(session, 'yes'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.pitchGreen.withValues(alpha: 0.15),
                        foregroundColor: AppColors.pitchGreenLight,
                        side: const BorderSide(color: AppColors.pitchGreenLight, width: 0.5),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: Text('YES (${session.oddsYes}x)\n[${session.maxRuns} runs]', textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => _placeSessionBet(session, 'no'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.red.withValues(alpha: 0.15),
                        foregroundColor: AppColors.red,
                        side: const BorderSide(color: AppColors.red, width: 0.5),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: Text('NO (${session.oddsNo}x)\n[${session.minRuns} runs]', textAlign: TextAlign.center, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
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

  void _placeSessionBet(SessionMarket session, String selection) {
    final txt = TextEditingController(text: '100');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('${session.label}: ${selection.toUpperCase()}', style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
        content: TextField(
          controller: txt,
          keyboardType: TextInputType.number,
          style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
          decoration: const InputDecoration(
            prefixText: '₹ ',
            prefixStyle: TextStyle(color: AppColors.gold, fontWeight: FontWeight.bold),
            hintText: 'Enter stake amount',
            enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.gold)),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: Colors.white70))),
          ElevatedButton(
            onPressed: () async {
              final amt = double.tryParse(txt.text);
              if (amt == null || amt <= 0) return;
              try {
                await _api.placeSessionBet(sessionId: session.id, selection: selection, amount: amt);
                SoundService.instance.play(Sfx.chipBet);
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Session Bet Placed Successfully! 🏏'),
                    backgroundColor: AppColors.pitchGreen,
                  ));
                }
                _loadMyBets();
              } catch (_) {
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                    content: Text('Insufficient wallet balance or market closed'),
                    backgroundColor: AppColors.red,
                  ));
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
            child: const Text('Confirm', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // ── Tab 3: Match Stats & H2H ──
  Widget _buildStatsTab(String sportCat) {
    return ListView(
      physics: const BouncingScrollPhysics(),
      children: [
        // Win Probability Gauge
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Win Probability Meter', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('${_match.teamAShort} 54%', style: const TextStyle(color: AppColors.gold, fontSize: 12, fontWeight: FontWeight.w900)),
                  Text('${_match.teamBShort} 46%', style: const TextStyle(color: AppColors.pitchGreenLight, fontSize: 12, fontWeight: FontWeight.w900)),
                ],
              ),
              const SizedBox(height: 6),
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: const Row(
                  children: [
                    Expanded(flex: 54, child: SizedBox(height: 8, child: ColoredBox(color: AppColors.gold))),
                    Expanded(flex: 46, child: SizedBox(height: 8, child: ColoredBox(color: AppColors.pitchGreenLight))),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Recent Form Guide
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Recent Form (Last 5 Games)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(_match.teamAShort, style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                  _buildFormBadges(['W', 'W', 'L', 'W', 'D']),
                ],
              ),
              const Divider(color: Colors.white10, height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(_match.teamBShort, style: const TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                  _buildFormBadges(['L', 'W', 'W', 'L', 'W']),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Match Info details
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Match Details & Conditions', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
              const SizedBox(height: 10),
              _buildInfoRow('Sport Category', sportCat),
              _buildInfoRow('Tournament', _match.series),
              _buildInfoRow('Match Format', _match.format.toUpperCase()),
              _buildInfoRow('Payout Settlement', 'Instant Wallet Auto-Credit (₹)'),
              _buildInfoRow('Fair Play Engine', 'Certified RNG & Real-Time Decimal Multipliers'),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildFormBadges(List<String> results) {
    return Row(
      children: results.map((r) {
        final color = r == 'W' ? AppColors.pitchGreenLight : (r == 'D' ? Colors.orange : AppColors.red);
        return Container(
          width: 22,
          height: 22,
          margin: const EdgeInsets.only(left: 4),
          decoration: BoxDecoration(color: color.withValues(alpha: 0.2), shape: BoxShape.circle, border: Border.all(color: color)),
          child: Center(child: Text(r, style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold))),
        );
      }).toList(),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  // ── Tab 4: My Bets ──
  Widget _buildMyBetsTab() {
    if (_loadingBets) {
      return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    }

    if (_myBets.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.receipt_long_rounded, color: Colors.white24, size: 48),
            const SizedBox(height: 10),
            const Text('No Bets Placed on this Match Yet', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            const Text('Select an odds outcome above to place your first bet in ₹', style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => _tabController.animateTo(0),
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
              child: const Text('Explore Match Odds', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      itemCount: _myBets.length,
      itemBuilder: (context, idx) {
        final bet = _myBets[idx];
        final isWon = bet.status == 'won';
        final isLost = bet.status == 'lost';
        final color = isWon ? AppColors.pitchGreenLight : (isLost ? AppColors.red : AppColors.gold);

        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.cardBg,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: color.withValues(alpha: 0.4)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(bet.optionLabel, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                  Text(bet.marketLabel, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                  const SizedBox(height: 4),
                  Text('Odds: ${bet.odds.toStringAsFixed(2)}x · Stake: ₹${bet.amount.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white70, fontSize: 10)),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
                    child: Text(bet.status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                  const SizedBox(height: 4),
                  Text('Win: ₹${bet.payout.toStringAsFixed(2)}', style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w900)),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}
