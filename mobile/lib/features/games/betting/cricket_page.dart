import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'local_cricket_storage.dart';

/// Premium Cricket Hub — Dream11 & MPL Style Design
class CricketPage extends StatefulWidget {
  const CricketPage({super.key});
  @override
  State<CricketPage> createState() => _CricketPageState();
}

class _CricketPageState extends State<CricketPage>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  List<dynamic> _matches = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get('/api/betting/cricket/matches');
      final fetchedMatches = res.data['matches'] as List<dynamic>;
      await LocalCricketStorage.saveMatches(fetchedMatches);
      if (!mounted) return;
      setState(() {
        _matches = fetchedMatches;
        _loading = false;
      });
    } catch (_) {
      // Offline fallback
      final cached = await LocalCricketStorage.getMatches();
      if (!mounted) return;
      setState(() {
        _matches = cached;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Cricket Fantasy & Betting',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          )
        ],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.gold,
          indicatorWeight: 3,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          labelPadding: const EdgeInsets.symmetric(horizontal: 4),
          labelStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
          tabs: const [
            Tab(icon: Icon(Icons.sports_cricket_rounded, size: 18), text: 'Fixtures'),
            Tab(icon: Icon(Icons.emoji_events_rounded, size: 18), text: 'My Contests'),
            Tab(icon: Icon(Icons.groups_rounded, size: 18), text: 'My Teams'),
            Tab(child: Center(child: Text('History'))),
          ],
        ),
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(color: AppColors.gold))
          : TabBarView(
              controller: _tabs,
              children: [
                _LobbyTab(matches: _matches, onRefresh: _load),
                _MyContestsTab(matches: _matches),
                _MyCreatedTeamsTab(matches: _matches),
                const _HistoryTab(),
              ],
            ),
    );
  }
}

// =============================================================================
// LOBBY TAB (UPCOMING & LIVE FIXTURES)
// =============================================================================

class _LobbyTab extends StatelessWidget {
  final List<dynamic> matches;
  final VoidCallback onRefresh;
  const _LobbyTab({required this.matches, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    final upcoming = matches.where((m) => m['status'] == 'upcoming').toList();
    final live = matches.where((m) => m['status'] == 'live').toList();

    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      color: AppColors.gold,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          // Identity banner — establishes the Dream11/MPL-style fantasy
          // framing up front, same visual language as the other game hubs.
          Container(
            padding: const EdgeInsets.all(18),
            margin: const EdgeInsets.only(bottom: 18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  begin: Alignment.topLeft, end: Alignment.bottomRight, colors: AppColors.cricketGrad),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.6), width: 1.5),
              boxShadow: [
                BoxShadow(color: AppColors.cricketGrad.last.withValues(alpha: 0.5), blurRadius: 18, offset: const Offset(0, 8)),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 54, height: 54,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(colors: [
                      Colors.white.withValues(alpha: 0.22),
                      Colors.white.withValues(alpha: 0.06),
                    ]),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 1.2),
                  ),
                  child: const Center(child: Text('🏏', style: TextStyle(fontSize: 26))),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Fantasy Cricket',
                          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white)),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.28),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
                        ),
                        child: const Text('DRAFT · COMPETE · WIN CASH',
                            style: TextStyle(
                                fontSize: 9.5, fontWeight: FontWeight.w800, letterSpacing: 0.6, color: Colors.white)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (live.isNotEmpty) ...[
            const Row(
              children: [
                Icon(Icons.live_tv_rounded, color: AppColors.red, size: 16),
                SizedBox(width: 6),
                Text('LIVE Matches',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 14)),
              ],
            ),
            const SizedBox(height: 8),
            ...live.map((m) => _MatchLobbyCard(match: m, isLive: true)),
            const SizedBox(height: 16),
          ],
          const Row(
            children: [
              Icon(Icons.upcoming, color: AppColors.green, size: 16),
              SizedBox(width: 6),
              Text('Upcoming Fixtures',
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14)),
            ],
          ),
          const SizedBox(height: 8),
          if (upcoming.isEmpty)
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Text('No upcoming fixtures',
                    style: TextStyle(color: AppColors.textSecondary)),
              ),
            )
          else
            ...upcoming.map((m) => _MatchLobbyCard(match: m, isLive: false)),
        ],
      ),
    );
  }
}

class _MatchLobbyCard extends StatelessWidget {
  final dynamic match;
  final bool isLive;
  const _MatchLobbyCard({required this.match, required this.isLive});

  @override
  Widget build(BuildContext context) {
    final teamA = match['team_a'] ?? 'Team A';
    final teamB = match['team_b'] ?? 'Team B';
    final teamAShort = match['team_a_short'] ?? 'TMA';
    final teamBShort = match['team_b_short'] ?? 'TMB';
    final series = match['series'] ?? 'Tournament Series';
    final startStr = match['start_time'] ?? '';
    final score = match['live_score'] as Map<String, dynamic>?;

    String countdown = 'Upcoming';
    if (!isLive && startStr.isNotEmpty) {
      final dt = DateTime.tryParse(startStr);
      if (dt != null) {
        final diff = dt.difference(DateTime.now());
        if (diff.isNegative) {
          countdown = 'Starting soon';
        } else if (diff.inDays > 0) {
          countdown = '${diff.inDays}d ${diff.inHours % 24}h';
        } else {
          countdown = '${diff.inHours}h ${diff.inMinutes % 60}m';
        }
      }
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
            color: isLive ? AppColors.red.withValues(alpha: 0.5) : AppColors.gold.withValues(alpha: 0.35),
            width: isLive ? 1.5 : 1),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => isLive
                  ? _LiveMatchCenterScreen(match: match)
                  : _FantasyContestLobbyScreen(match: match),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              // Header line
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(series,
                      style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 11,
                          fontWeight: FontWeight.w600)),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isLive
                          ? AppColors.red.withValues(alpha: 0.2)
                          : Colors.white.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                          color: isLive ? AppColors.red.withValues(alpha: 0.5) : Colors.white.withValues(alpha: 0.12)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (isLive) ...[
                          Container(
                            width: 5, height: 5,
                            decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle),
                          ),
                          const SizedBox(width: 4),
                        ],
                        Text(
                          isLive
                              ? 'LIVE'
                              : (match['format'] ?? 'T20').toString().toUpperCase(),
                          style: TextStyle(
                              color: isLive ? AppColors.red : AppColors.gold,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.5),
                        ),
                      ],
                    ),
                  )
                ],
              ),
              const SizedBox(height: 12),
              // Teams and Flags Row
              Row(
                children: [
                  // Team A Logo + Name
                  Expanded(
                    child: Row(
                      children: [
                        _buildTeamFlag(match['team_a_flag']),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(teamAShort,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14)),
                              Text(teamA,
                                  style: const TextStyle(
                                      color: AppColors.textSecondary,
                                      fontSize: 11),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Middle Status / Time
                  Column(
                    children: [
                      if (isLive) ...[
                        const Text('VS',
                            style: TextStyle(
                                color: AppColors.gold,
                                fontWeight: FontWeight.w900,
                                fontSize: 13)),
                        if (score != null && score.containsKey('runs'))
                          Text('${score['runs']}/${score['wickets']}',
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold))
                        else
                          const Text('Live Match',
                              style: TextStyle(
                                  color: AppColors.textSecondary, fontSize: 10))
                      ] else ...[
                        Text(countdown,
                            style: const TextStyle(
                                color: Colors.orange,
                                fontSize: 12,
                                fontWeight: FontWeight.bold)),
                        const Text('VS',
                            style: TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 10,
                                fontWeight: FontWeight.bold)),
                      ]
                    ],
                  ),
                  // Team B Logo + Name
                  Expanded(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(teamBShort,
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 14)),
                              Text(teamB,
                                  style: const TextStyle(
                                      color: AppColors.textSecondary,
                                      fontSize: 11),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _buildTeamFlag(match['team_b_flag']),
                      ],
                    ),
                  ),
                ],
              ),
              const Divider(color: Colors.white10, height: 24),
              // Card Footer CTA
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(isLive ? Icons.bar_chart_rounded : Icons.groups_rounded,
                          size: 13, color: AppColors.textSecondary),
                      const SizedBox(width: 5),
                      Text(isLive ? 'Live fantasy points' : 'Contests open',
                          style: const TextStyle(color: Colors.white70, fontSize: 11)),
                    ],
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.gold.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.gold.withValues(alpha: 0.5)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                            isLive ? 'View Live' : 'Draft Team',
                            style: const TextStyle(
                                color: AppColors.goldLight,
                                fontWeight: FontWeight.w800,
                                fontSize: 11)),
                        const SizedBox(width: 3),
                        const Icon(Icons.chevron_right_rounded, size: 14, color: AppColors.goldLight),
                      ],
                    ),
                  ),
                ],
              )
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTeamFlag(String? url) {
    final ring = Container(
      width: 40,
      height: 40,
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [
          Colors.white.withValues(alpha: 0.18),
          Colors.white.withValues(alpha: 0.04),
        ]),
        border: Border.all(color: Colors.white.withValues(alpha: 0.3), width: 1),
      ),
      child: url == null || url.isEmpty
          ? const Icon(Icons.flag_rounded, color: Colors.white60, size: 16)
          : ClipOval(
              child: Image.network(url, fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const Icon(Icons.flag_rounded, color: Colors.white60, size: 16)),
            ),
    );
    return ring;
  }
}

// =============================================================================
// FANTASY CONTEST LOBBY SCREEN (DREAM11 STYLE CONTESTS)
// =============================================================================

class _FantasyContestLobbyScreen extends StatefulWidget {
  final dynamic match;
  const _FantasyContestLobbyScreen({required this.match});

  @override
  State<_FantasyContestLobbyScreen> createState() =>
      _FantasyContestLobbyScreenState();
}

class _FantasyContestLobbyScreenState
    extends State<_FantasyContestLobbyScreen> {
  List<dynamic> _leagues = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await ApiClient().dio.get(
          '/api/betting/cricket/fantasy/leagues?match_id=${widget.match['id']}');
      final fetchedLeagues = res.data['leagues'] as List<dynamic>;
      await LocalCricketStorage.saveLeagues(widget.match['id'], fetchedLeagues);
      if (!mounted) return;
      setState(() {
        _leagues = fetchedLeagues;
        _loading = false;
      });
    } catch (_) {
      final cached = await LocalCricketStorage.getLeagues(widget.match['id']);
      if (!mounted) return;
      setState(() {
        _leagues = cached;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(
            '${widget.match['team_a_short']} vs ${widget.match['team_b_short']} contests',
            style: const TextStyle(fontSize: 16)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          )
        ],
      ),
      body: Column(
        children: [
          // Match Header Banner
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${widget.match['team_a']} vs ${widget.match['team_b']}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 13)),
                Text('${widget.match['series']}',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 11)),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: AppColors.gold))
                : _leagues.isEmpty
                    ? const Center(
                        child: Text('No contests available for this fixture',
                            style: TextStyle(color: AppColors.textSecondary)),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _leagues.length,
                        itemBuilder: (_, i) {
                          final league = _leagues[i];
                          final joinedCount = league['joined_count'] ?? 0;
                          final joined = joinedCount > 0;
                          final spotsFilled = league['current_entries'] ?? 0;
                          final maxSpots = league['max_entries'] ?? 100;
                          final pct = (spotsFilled / maxSpots).clamp(0.0, 1.0);

                          return Card(
                            color: AppColors.cardBg,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14)),
                            margin: const EdgeInsets.only(bottom: 14),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Row(
                                          children: [
                                            Flexible(
                                              child: Text(league['name'] ?? 'Contest',
                                                  overflow: TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                      color: Colors.white,
                                                      fontSize: 13,
                                                      fontWeight: FontWeight.bold)),
                                            ),
                                            if (joined) ...[
                                              const SizedBox(width: 6),
                                              Container(
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: AppColors.green.withValues(alpha: 0.18),
                                                  borderRadius: BorderRadius.circular(8),
                                                ),
                                                child: Text('Joined ×$joinedCount',
                                                    style: const TextStyle(
                                                        color: AppColors.green,
                                                        fontSize: 9,
                                                        fontWeight: FontWeight.bold)),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),
                                      Text(
                                          league['entry_fee'] == 0
                                              ? 'FREE'
                                              : '₹${league['entry_fee']}',
                                          style: const TextStyle(
                                              color: AppColors.goldLight,
                                              fontWeight: FontWeight.w900,
                                              fontSize: 14)),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    'Prize Pool: ₹${league['prize_pool']}',
                                    style: const TextStyle(
                                        color: Colors.white70, fontSize: 11),
                                  ),
                                  const SizedBox(height: 12),
                                  // Spot capacity progress
                                  LinearProgressIndicator(
                                    value: pct,
                                    backgroundColor: Colors.white10,
                                    valueColor: const AlwaysStoppedAnimation(
                                        AppColors.gold),
                                    borderRadius: BorderRadius.circular(4),
                                    minHeight: 6,
                                  ),
                                  const SizedBox(height: 6),
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                          '${maxSpots - spotsFilled} spots left',
                                          style: const TextStyle(
                                              color: Colors.orange,
                                              fontSize: 10,
                                              fontWeight: FontWeight.bold)),
                                      Text('$maxSpots spots total',
                                          style: const TextStyle(
                                              color: AppColors.textSecondary,
                                              fontSize: 10)),
                                    ],
                                  ),
                                  const Divider(
                                      color: Colors.white10, height: 20),
                                  Row(
                                    mainAxisAlignment:
                                        MainAxisAlignment.spaceBetween,
                                    children: [
                                      const Row(
                                        children: [
                                          Icon(Icons.shield_outlined,
                                              color: AppColors.textSecondary,
                                              size: 14),
                                          SizedBox(width: 4),
                                          Text('Guaranteed Winner payouts',
                                              style: TextStyle(
                                                  color:
                                                      AppColors.textSecondary,
                                                  fontSize: 9)),
                                        ],
                                      ),
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          if (joined) ...[
                                            OutlinedButton(
                                              onPressed: () {
                                                Navigator.push(
                                                  context,
                                                  MaterialPageRoute(
                                                    builder: (_) =>
                                                        _ContestLeaderboardScreen(
                                                            league: league),
                                                  ),
                                                );
                                              },
                                              style: OutlinedButton.styleFrom(
                                                side: const BorderSide(color: AppColors.green),
                                                foregroundColor: AppColors.green,
                                                padding: const EdgeInsets.symmetric(
                                                    horizontal: 12, vertical: 8),
                                                shape: RoundedRectangleBorder(
                                                    borderRadius:
                                                        BorderRadius.circular(8)),
                                              ),
                                              child: const Text('Leaderboard',
                                                  style: TextStyle(
                                                      fontWeight: FontWeight.bold,
                                                      fontSize: 12)),
                                            ),
                                            const SizedBox(width: 8),
                                          ],
                                          ElevatedButton(
                                            onPressed: () {
                                              Navigator.push(
                                                context,
                                                MaterialPageRoute(
                                                  builder: (_) =>
                                                      _DraftTeamScreen(
                                                          match: widget.match,
                                                          league: league),
                                                ),
                                              );
                                            },
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor: AppColors.gold,
                                              foregroundColor: Colors.black,
                                              padding: const EdgeInsets.symmetric(
                                                  horizontal: 16, vertical: 8),
                                              shape: RoundedRectangleBorder(
                                                  borderRadius:
                                                      BorderRadius.circular(8)),
                                            ),
                                            child: Text(
                                              joined
                                                  ? 'Join Again'
                                                  : 'Draft & Join',
                                              style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                  fontSize: 12),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// FANTASY TEAM DRAFTER (WK, BAT, AR, BWL SELECTION GRID)
// =============================================================================

class _DraftTeamScreen extends StatefulWidget {
  final dynamic match;
  final dynamic league;
  const _DraftTeamScreen({required this.match, required this.league});

  @override
  State<_DraftTeamScreen> createState() => _DraftTeamScreenState();
}

class _DraftTeamScreenState extends State<_DraftTeamScreen>
    with SingleTickerProviderStateMixin {
  late TabController _roleTabs;
  List<dynamic> _players = [];
  bool _loading = true;

  final Set<String> _selectedIds = {};
  String? _captainId;
  String? _vcId;

  // Step indicator (0 = pick 11, 1 = pick C/VC)
  int _currentStep = 0;

  @override
  void initState() {
    super.initState();
    _roleTabs = TabController(length: 4, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _roleTabs.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient()
          .dio
          .get('/api/betting/cricket/players?match_id=${widget.match['id']}');
      final fetchedPlayers = res.data['players'] as List<dynamic>;
      await LocalCricketStorage.savePlayers(widget.match['id'], fetchedPlayers);
      if (!mounted) return;
      setState(() {
        _players = fetchedPlayers;
        _loading = false;
      });
    } catch (_) {
      final cached = await LocalCricketStorage.getPlayers(widget.match['id']);
      if (!mounted) return;
      setState(() {
        _players = cached;
        _loading = false;
      });
    }
  }

  double get _totalCredits => _players
      .where((p) => _selectedIds.contains(p['id'] as String))
      .fold(0.0, (s, p) => s + (double.tryParse(p['credits'].toString()) ?? 0));

  int _countByRole(String role) => _players
      .where(
          (p) => _selectedIds.contains(p['id'] as String) && p['role'] == role)
      .length;

  int _countByTeam(String team) => _players
      .where((p) =>
          _selectedIds.contains(p['id'] as String) && p['team_name'] == team)
      .length;

  String? get _validationMessage {
    if (_selectedIds.length != 11) {
      return 'Pick exactly 11 players (${_selectedIds.length}/11 selected)';
    }
    if (_totalCredits > 120.0) {
      return 'Credit limit exceeded! ${_totalCredits.toStringAsFixed(1)}/120 cr';
    }
    final wk = _countByRole('wicket_keeper');
    final bat = _countByRole('batsman');
    final ar = _countByRole('all_rounder');
    final bowl = _countByRole('bowler');

    if (wk < 1 || wk > 4) return 'WK must be between 1 and 4';
    if (bat < 3 || bat > 6) return 'BAT must be between 3 and 6';
    if (ar < 1 || ar > 4) return 'AR must be between 1 and 4';
    if (bowl < 3 || bowl > 6) return 'BOWL must be between 3 and 6';

    final teamA = widget.match['team_a'];
    final teamB = widget.match['team_b'];
    if (_countByTeam(teamA) > 7 || _countByTeam(teamB) > 7) {
      return 'Maximum 7 players allowed from a single team';
    }
    return null;
  }

  void _togglePlayer(dynamic p) {
    final id = p['id'] as String;
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
        if (_captainId == id) _captainId = null;
        if (_vcId == id) _vcId = null;
      } else {
        if (_selectedIds.length >= 11) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Roster is already full (11/11)!'),
            backgroundColor: AppColors.red,
          ));
          return;
        }
        final cost = double.tryParse(p['credits'].toString()) ?? 0;
        if (_totalCredits + cost > 120.0) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Insufficient credit budget!'),
            backgroundColor: AppColors.red,
          ));
          return;
        }
        _selectedIds.add(id);
      }
    });
  }

  Future<void> _submitAndJoin() async {
    if (_captainId == null || _vcId == null) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Please select Captain (2x) and Vice-Captain (1.5x)'),
        backgroundColor: AppColors.red,
      ));
      return;
    }
    setState(() => _loading = true);
    try {
      // 1. Submit Fantasy Team
      final teamRes = await ApiClient()
          .dio
          .post('/api/betting/cricket/fantasy/team', data: {
        'match_id': widget.match['id'],
        'player_ids': _selectedIds.toList(),
        'captain_id': _captainId,
        'vice_captain_id': _vcId,
      });
      // 2. Join contest league with created team
      await ApiClient().dio.post('/api/betting/cricket/fantasy/join', data: {
        'league_id': widget.league['id'],
        'team_id': teamRes.data['team_id'],
      });
      SoundService.instance.play(Sfx.chipBet);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Successfully joined fantasy league contest! 🏏'),
        backgroundColor: AppColors.green,
      ));
      Navigator.pop(context); // Go back to fixtures
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      final err = e.response?.data?['error'] ?? 'Failed to join contest';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(err),
        backgroundColor: AppColors.red,
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Failed to join contest'),
        backgroundColor: AppColors.red,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    final teamA = widget.match['team_a_short'] ?? 'IND';
    final teamB = widget.match['team_b_short'] ?? 'AUS';

    if (_loading) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(child: CircularProgressIndicator(color: AppColors.gold)),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(
          _currentStep == 0
              ? 'Draft Fantasy Team (${_selectedIds.length}/11)'
              : 'Choose Captain & Vice Captain',
          style: const TextStyle(fontSize: 16),
        ),
        bottom: _currentStep == 0
            ? TabBar(
                controller: _roleTabs,
                indicatorColor: AppColors.gold,
                labelColor: AppColors.gold,
                unselectedLabelColor: AppColors.textSecondary,
                tabs: [
                  Tab(text: 'WK (${_countByRole('wicket_keeper')})'),
                  Tab(text: 'BAT (${_countByRole('batsman')})'),
                  Tab(text: 'AR (${_countByRole('all_rounder')})'),
                  Tab(text: 'BOWL (${_countByRole('bowler')})'),
                ],
              )
            : null,
      ),
      body: Column(
        children: [
          // Header Credit Counter Bar
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Text(
                  '$teamA: ${_countByTeam(widget.match['team_a'])}   $teamB: ${_countByTeam(widget.match['team_b'])}',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.bold),
                ),
                const Spacer(),
                Text(
                  'Credits Left: ${(120.0 - _totalCredits).toStringAsFixed(1)} Cr',
                  style: const TextStyle(
                      color: AppColors.goldLight,
                      fontSize: 12,
                      fontWeight: FontWeight.bold),
                ),
              ],
            ),
          ),
          // Progress indicators
          Container(
            height: 4,
            width: double.infinity,
            color: Colors.white10,
            child: Row(
              children: List.generate(11, (i) {
                final active = _selectedIds.length > i;
                return Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 1.5),
                    color: active ? AppColors.green : Colors.transparent,
                  ),
                );
              }),
            ),
          ),
          // Body steps selector
          Expanded(
            child: _currentStep == 0
                ? TabBarView(
                    controller: _roleTabs,
                    children: [
                      _buildRoleDraftList('wicket_keeper'),
                      _buildRoleDraftList('batsman'),
                      _buildRoleDraftList('all_rounder'),
                      _buildRoleDraftList('bowler'),
                    ],
                  )
                : _buildCaptainSelectStep(),
          ),
          // Footer command bars
          _buildDraftFooter(),
        ],
      ),
    );
  }

  Widget _buildRoleDraftList(String role) {
    final rolePlayers = _players.where((p) => p['role'] == role).toList();
    if (rolePlayers.isEmpty) {
      return const Center(
          child: Text('No players listed',
              style: TextStyle(color: AppColors.textSecondary)));
    }
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: rolePlayers.length,
      separatorBuilder: (_, __) => const Divider(color: Colors.white10),
      itemBuilder: (_, i) {
        final p = rolePlayers[i];
        final isSelected = _selectedIds.contains(p['id'] as String);
        return ListTile(
          onTap: () => _togglePlayer(p),
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.white.withValues(alpha: 0.05),
              image: p['avatar_url'] != null
                  ? DecorationImage(
                      image: NetworkImage(p['avatar_url']),
                      fit: BoxFit.cover,
                    )
                  : null,
            ),
            child: p['avatar_url'] == null
                ? const Icon(Icons.person, color: Colors.white54)
                : null,
          ),
          title: Text(p['name'] ?? '',
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13)),
          subtitle: Text(
            (p['team_name'] ?? '').toString().toUpperCase(),
            style:
                const TextStyle(color: AppColors.textSecondary, fontSize: 10),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('${p['credits']} Cr',
                  style: const TextStyle(
                      color: AppColors.goldLight,
                      fontWeight: FontWeight.bold,
                      fontSize: 13)),
              const SizedBox(width: 14),
              Icon(
                isSelected ? Icons.check_circle : Icons.add_circle_outline,
                color: isSelected ? AppColors.green : Colors.white24,
                size: 24,
              )
            ],
          ),
        );
      },
    );
  }

  Widget _buildCaptainSelectStep() {
    final selectedPlayers = _players
        .where((p) => _selectedIds.contains(p['id'] as String))
        .toList();

    return Column(
      children: [
        const Padding(
          padding: EdgeInsets.all(12),
          child: Text(
            'Captain (C) gets 2.0x points and Vice Captain (VC) gets 1.5x points.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
            textAlign: TextAlign.center,
          ),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: selectedPlayers.length,
            separatorBuilder: (_, __) => const Divider(color: Colors.white10),
            itemBuilder: (_, i) {
              final p = selectedPlayers[i];
              final isC = _captainId == p['id'];
              final isVC = _vcId == p['id'];

              return ListTile(
                leading: CircleAvatar(
                  backgroundImage: p['avatar_url'] != null
                      ? NetworkImage(p['avatar_url'])
                      : null,
                  backgroundColor: Colors.white10,
                  child: p['avatar_url'] == null
                      ? const Icon(Icons.person, color: Colors.white70)
                      : null,
                ),
                title: Text(p['name'] ?? '',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                subtitle: Text(
                  '${(p['role'] as String).replaceFirst('_', ' ').toUpperCase()}  •  ${p['team_name']}',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 10),
                ),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Captain button
                    InkWell(
                      onTap: () {
                        setState(() {
                          if (isC) {
                            _captainId = null;
                          } else {
                            if (_vcId == p['id']) _vcId = null;
                            _captainId = p['id'] as String;
                          }
                        });
                      },
                      child: Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isC ? AppColors.gold : Colors.white10,
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Text(
                          'C',
                          style: TextStyle(
                              color: isC ? Colors.black : Colors.white70,
                              fontWeight: FontWeight.bold,
                              fontSize: 12),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    // VC button
                    InkWell(
                      onTap: () {
                        setState(() {
                          if (isVC) {
                            _vcId = null;
                          } else {
                            if (_captainId == p['id']) _captainId = null;
                            _vcId = p['id'] as String;
                          }
                        });
                      },
                      child: Container(
                        width: 34,
                        height: 34,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isVC ? Colors.white : Colors.white10,
                          border: Border.all(color: Colors.white24),
                        ),
                        child: Text(
                          'VC',
                          style: TextStyle(
                              color: isVC ? Colors.black : Colors.white70,
                              fontWeight: FontWeight.bold,
                              fontSize: 11),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        )
      ],
    );
  }

  Widget _buildDraftFooter() {
    final validation = _validationMessage;

    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_currentStep == 0 && validation != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                validation,
                style: const TextStyle(color: Colors.orange, fontSize: 11),
                textAlign: TextAlign.center,
              ),
            ),
          Row(
            children: [
              // Preview pitch button
              if (_currentStep == 0)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      final selectedPlayers = _players
                          .where(
                              (p) => _selectedIds.contains(p['id'] as String))
                          .toList();
                      _showTeamPreviewPitch(context, selectedPlayers);
                    },
                    icon:
                        const Icon(Icons.sports_cricket, color: AppColors.gold),
                    label: const Text('Pitch Preview',
                        style: TextStyle(color: Colors.white)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: AppColors.gold),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                )
              else
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => setState(() => _currentStep = 0),
                    child: const Text('Back',
                        style: TextStyle(color: Colors.white)),
                  ),
                ),
              const SizedBox(width: 12),
              // Action Button
              Expanded(
                child: ElevatedButton(
                  onPressed: () {
                    if (_currentStep == 0) {
                      if (validation == null) {
                        setState(() => _currentStep = 1);
                      } else {
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                          content: Text(validation),
                          backgroundColor: AppColors.red,
                        ));
                      }
                    } else {
                      _submitAndJoin();
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                  ),
                  child: Text(
                    _currentStep == 0
                        ? 'Continue to C/VC'
                        : 'Save & Join Contest',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              )
            ],
          )
        ],
      ),
    );
  }

  // --- Green Turf Cricket Field Pitch Overlay Preview ---
  void _showTeamPreviewPitch(BuildContext context, List<dynamic> players) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        final wk = players.where((p) => p['role'] == 'wicket_keeper').toList();
        final bat = players.where((p) => p['role'] == 'batsman').toList();
        final ar = players.where((p) => p['role'] == 'all_rounder').toList();
        final bowl = players.where((p) => p['role'] == 'bowler').toList();

        return Container(
          height: MediaQuery.of(context).size.height * 0.82,
          decoration: const BoxDecoration(
            color: Color(0xFF0F2B14),
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              // Pitch Banner Header
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Team Preview Pitch',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14)),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              // Field Turf Content
              Expanded(
                child: Stack(
                  children: [
                    // Field Turf Draw Pattern
                    Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.green.shade900,
                            Colors.green.shade800,
                            Colors.green.shade900,
                          ],
                        ),
                      ),
                    ),
                    // Draw outer crease oval boundary lines
                    Center(
                      child: Container(
                        width: MediaQuery.of(context).size.width * 0.88,
                        height: MediaQuery.of(context).size.height * 0.68,
                        decoration: BoxDecoration(
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.18),
                              width: 1.5),
                          borderRadius: BorderRadius.all(
                            Radius.elliptical(
                                MediaQuery.of(context).size.width * 0.44,
                                MediaQuery.of(context).size.height * 0.34),
                          ),
                        ),
                      ),
                    ),
                    // Center Pitch Sandy Ground rectangle
                    Center(
                      child: Container(
                        width: 48,
                        height: 120,
                        decoration: BoxDecoration(
                          color:
                              const Color(0xFFDFD1B0).withValues(alpha: 0.55),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.3),
                              width: 1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                    // Renders players vertically by role
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        // Bowlers (Top)
                        _buildPitchPlayerRow('BOWLERS', bowl),
                        // All-rounders (Upper-mid)
                        _buildPitchPlayerRow('ALL-ROUNDERS', ar),
                        // Batsmen (Lower-mid)
                        _buildPitchPlayerRow('BATSMEN', bat),
                        // Wicket Keepers (Bottom)
                        _buildPitchPlayerRow('WICKET KEEPERS', wk),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPitchPlayerRow(String header, List<dynamic> players) {
    if (players.isEmpty) {
      return Container();
    }
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: players.map((p) {
            final isC = _captainId == p['id'];
            final isVC = _vcId == p['id'];
            final shortName = p['name'] != null
                ? (p['name'].toString().split(' ').last)
                : 'Player';

            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10),
              child: Column(
                children: [
                  Stack(
                    alignment: Alignment.center,
                    children: [
                      // Circular player photo (falls back to a shirt icon
                      // when the player has no avatar_url on file).
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: p['team_name'] == widget.match['team_a']
                              ? Colors.black
                              : Colors.white,
                          border: Border.all(
                              color: AppColors.goldLight, width: 1.5),
                          image: p['avatar_url'] != null
                              ? DecorationImage(
                                  image: NetworkImage(p['avatar_url']),
                                  fit: BoxFit.cover,
                                )
                              : null,
                        ),
                        child: p['avatar_url'] == null
                            ? Center(
                                child: Icon(
                                  Icons.sports_cricket,
                                  size: 18,
                                  color:
                                      p['team_name'] == widget.match['team_a']
                                          ? Colors.white
                                          : Colors.black,
                                ),
                              )
                            : null,
                      ),
                      // Role multiplier bubble (C / VC)
                      if (isC || isVC)
                        Positioned(
                          right: 0,
                          top: 0,
                          child: Container(
                            padding: const EdgeInsets.all(2.5),
                            decoration: BoxDecoration(
                              color: isC ? AppColors.gold : Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.black),
                            ),
                            child: Text(
                              isC ? 'C' : 'VC',
                              style: const TextStyle(
                                  color: Colors.black,
                                  fontWeight: FontWeight.bold,
                                  fontSize: 8),
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  // Name sticker backing tag
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: p['team_name'] == widget.match['team_a']
                          ? Colors.black87
                          : Colors.white,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      shortName,
                      style: TextStyle(
                          color: p['team_name'] == widget.match['team_a']
                              ? Colors.white
                              : Colors.black,
                          fontSize: 9,
                          fontWeight: FontWeight.bold),
                    ),
                  ),
                  Text('${p['credits']} Cr',
                      style:
                          const TextStyle(color: Colors.white70, fontSize: 8)),
                ],
              ),
            );
          }).toList(),
        ),
      ],
    );
  }
}

// =============================================================================
// CONTEST LEADERBOARD SCREEN
// =============================================================================

class _ContestLeaderboardScreen extends StatefulWidget {
  final dynamic league;
  const _ContestLeaderboardScreen({required this.league});

  @override
  State<_ContestLeaderboardScreen> createState() =>
      _ContestLeaderboardScreenState();
}

class _ContestLeaderboardScreenState extends State<_ContestLeaderboardScreen> {
  List<dynamic> _leaderboard = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get(
          '/api/betting/cricket/fantasy/leagues/${widget.league['id']}/leaderboard');
      if (!mounted) return;
      setState(() {
        _leaderboard = res.data['leaderboard'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.league['name'] ?? 'Contest Leaderboard',
            style: const TextStyle(fontSize: 16)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          )
        ],
      ),
      body: Column(
        children: [
          // Banner
          Container(
            color: AppColors.surface,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Prize Pool: ₹${widget.league['prize_pool']}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 12)),
                Text('${_leaderboard.length} Teams joined',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 11)),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: AppColors.gold))
                : _leaderboard.isEmpty
                    ? const Center(
                        child: Text('No entries in this leaderboard',
                            style: TextStyle(color: AppColors.textSecondary)),
                      )
                    : ListView.separated(
                        padding: const EdgeInsets.all(12),
                        itemCount: _leaderboard.length,
                        separatorBuilder: (_, __) =>
                            const Divider(color: Colors.white10),
                        itemBuilder: (_, i) {
                          final entry = _leaderboard[i];
                          final rank = entry['final_rank'] ?? (i + 1);

                          return ListTile(
                            onTap: () => _viewUserTeam(entry['team_id']),
                            leading: Container(
                              width: 32,
                              height: 32,
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                color: rank == 1
                                    ? AppColors.gold.withValues(alpha: 0.2)
                                    : Colors.white10,
                                shape: BoxShape.circle,
                                border: Border.all(
                                    color: rank == 1
                                        ? AppColors.gold
                                        : Colors.transparent),
                              ),
                              child: Text(
                                '#$rank',
                                style: TextStyle(
                                    color: rank == 1
                                        ? AppColors.gold
                                        : Colors.white70,
                                    fontSize: 11,
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                            title: Text(entry['username'] ?? 'Player',
                                style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold)),
                            subtitle: Text(
                              'C: ${entry['captain_name']}  •  VC: ${entry['vice_captain_name']}',
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 10),
                            ),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('${entry['points']} pts',
                                    style: const TextStyle(
                                        color: AppColors.goldLight,
                                        fontWeight: FontWeight.w900,
                                        fontSize: 13)),
                                if (double.tryParse(entry['payout_received']
                                            .toString()) !=
                                        null &&
                                    double.parse(entry['payout_received']
                                            .toString()) >
                                        0)
                                  Text(
                                    'Won ₹${entry['payout_received']}',
                                    style: const TextStyle(
                                        color: AppColors.green,
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold),
                                  )
                              ],
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }

  Future<void> _viewUserTeam(String teamId) async {
    try {
      final res = await ApiClient()
          .dio
          .get('/api/betting/cricket/fantasy/team/$teamId');
      final players = res.data['players'] as List<dynamic>;
      final team = res.data['team'];
      if (!mounted) return;
      _showLeaderboardTeamPreview(context, team, players);
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Could not fetch player details for this roster'),
        backgroundColor: AppColors.red,
      ));
    }
  }

  void _showLeaderboardTeamPreview(
      BuildContext context, dynamic team, List<dynamic> players) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        final wk = players.where((p) => p['role'] == 'wicket_keeper').toList();
        final bat = players.where((p) => p['role'] == 'batsman').toList();
        final ar = players.where((p) => p['role'] == 'all_rounder').toList();
        final bowl = players.where((p) => p['role'] == 'bowler').toList();
        final capId = team['captain_id'];
        final vcId = team['vice_captain_id'];

        return Container(
          height: MediaQuery.of(context).size.height * 0.82,
          decoration: const BoxDecoration(
            color: Color(0xFF0F2B14),
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Roster Composition',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14)),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Stack(
                  children: [
                    // Turf green field
                    Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.green.shade900,
                            Colors.green.shade800,
                            Colors.green.shade900,
                          ],
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        width: MediaQuery.of(context).size.width * 0.88,
                        height: MediaQuery.of(context).size.height * 0.68,
                        decoration: BoxDecoration(
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.18),
                              width: 1.5),
                          borderRadius: BorderRadius.all(
                            Radius.elliptical(
                                MediaQuery.of(context).size.width * 0.44,
                                MediaQuery.of(context).size.height * 0.34),
                          ),
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        width: 48,
                        height: 120,
                        decoration: BoxDecoration(
                          color:
                              const Color(0xFFDFD1B0).withValues(alpha: 0.55),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.3),
                              width: 1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _buildRow(bowl, capId, vcId),
                        _buildRow(ar, capId, vcId),
                        _buildRow(bat, capId, vcId),
                        _buildRow(wk, capId, vcId),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRow(List<dynamic> list, String capId, String vcId) {
    if (list.isEmpty) return Container();
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: list.map((p) {
        final isC = capId == p['id'];
        final isVC = vcId == p['id'];
        final short = p['name'] != null
            ? (p['name'].toString().split(' ').last)
            : 'Player';

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Column(
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.black87,
                      border: Border.all(color: AppColors.gold, width: 1),
                      image: p['avatar_url'] != null
                          ? DecorationImage(
                              image: NetworkImage(p['avatar_url']),
                              fit: BoxFit.cover,
                            )
                          : null,
                    ),
                    child: p['avatar_url'] == null
                        ? const Center(
                            child: Icon(Icons.sports_cricket,
                                color: Colors.white70, size: 16),
                          )
                        : null,
                  ),
                  if (isC || isVC)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: isC ? AppColors.gold : Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          isC ? 'C' : 'VC',
                          style: const TextStyle(
                              color: Colors.black,
                              fontWeight: FontWeight.bold,
                              fontSize: 7),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 4, vertical: 1.5),
                decoration: BoxDecoration(
                  color: Colors.black87,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  short,
                  style: const TextStyle(color: Colors.white, fontSize: 8),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

// =============================================================================
// MY CONTESTS TAB (FANTASY USER ENTRIES)
// =============================================================================

class _MyContestsTab extends StatefulWidget {
  final List<dynamic> matches;
  const _MyContestsTab({required this.matches});

  @override
  State<_MyContestsTab> createState() => _MyContestsTabState();
}

class _MyContestsTabState extends State<_MyContestsTab> {
  List<dynamic> _joined = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final List<dynamic> out = [];
      for (final m in widget.matches) {
        final res = await ApiClient()
            .dio
            .get('/api/betting/cricket/fantasy/leagues?match_id=${m['id']}');
        final leagues = res.data['leagues'] as List<dynamic>;
        for (final l in leagues) {
          if ((l['joined_count'] ?? 0) > 0) {
            out.add({
              'match': m,
              'league': l,
            });
          }
        }
      }
      if (!mounted) return;
      setState(() {
        _joined = out;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.gold));
    }
    if (_joined.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.emoji_events_outlined,
                color: AppColors.textSecondary, size: 48),
            SizedBox(height: 12),
            Text('No contests joined yet',
                style: TextStyle(color: AppColors.textSecondary)),
            SizedBox(height: 4),
            Text('Browse fixtures and join a contest',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _joined.length,
        itemBuilder: (_, i) {
          final item = _joined[i];
          final match = item['match'];
          final league = item['league'];

          return Card(
            color: AppColors.cardBg,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => _ContestLeaderboardScreen(league: league),
                  ),
                );
              },
              title: Row(
                children: [
                  Flexible(
                    child: Text(league['name'] ?? 'Mega Contest',
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.bold)),
                  ),
                  if ((league['joined_count'] ?? 0) > 1) ...[
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.green.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text('×${league['joined_count']} entries',
                          style: const TextStyle(
                              color: AppColors.green,
                              fontSize: 9,
                              fontWeight: FontWeight.bold)),
                    ),
                  ],
                ],
              ),
              subtitle: Text(
                '${match['team_a_short']} vs ${match['team_b_short']}  •  ${match['series']}',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 10),
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('Fee: ₹${league['entry_fee']}',
                      style: const TextStyle(
                          color: AppColors.goldLight,
                          fontWeight: FontWeight.bold,
                          fontSize: 12)),
                  const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('View Leaderboard',
                          style: TextStyle(color: Colors.orange, fontSize: 9)),
                      Icon(Icons.chevron_right, color: Colors.orange, size: 12),
                    ],
                  )
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// =============================================================================
// MY CREATED TEAMS TAB
// =============================================================================

class _MyCreatedTeamsTab extends StatefulWidget {
  final List<dynamic> matches;
  const _MyCreatedTeamsTab({required this.matches});

  @override
  State<_MyCreatedTeamsTab> createState() => _MyCreatedTeamsTabState();
}

class _MyCreatedTeamsTabState extends State<_MyCreatedTeamsTab> {
  List<dynamic> _teams = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final List<dynamic> out = [];
      for (final m in widget.matches) {
        final res = await ApiClient()
            .dio
            .get('/api/betting/cricket/fantasy/my-teams?match_id=${m['id']}');
        final teams = res.data['teams'] as List<dynamic>;
        for (final t in teams) {
          out.add({
            'match': m,
            'team': t,
          });
        }
      }
      if (!mounted) return;
      setState(() {
        _teams = out;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.gold));
    }
    if (_teams.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.group_add_rounded,
                color: AppColors.textSecondary, size: 48),
            SizedBox(height: 12),
            Text('No fantasy teams drafted yet',
                style: TextStyle(color: AppColors.textSecondary)),
            SizedBox(height: 4),
            Text('Select a match and draft your roster',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _teams.length,
        itemBuilder: (_, i) {
          final item = _teams[i];
          final match = item['match'];
          final team = item['team'];

          return Card(
            color: AppColors.cardBg,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            margin: const EdgeInsets.only(bottom: 12),
            child: ListTile(
              onTap: () => _viewTeamRoster(team['id']),
              title: Text('Fantasy Squad Roster',
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      fontWeight: FontWeight.bold)),
              subtitle: Text(
                '${match['team_a_short']} vs ${match['team_b_short']}  •  C: ${team['captain_name']} | VC: ${team['vice_captain_name']}',
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 10),
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text('${team['points_total']} pts',
                      style: const TextStyle(
                          color: AppColors.goldLight,
                          fontWeight: FontWeight.bold,
                          fontSize: 12)),
                  const Text('Preview Pitch',
                      style: TextStyle(color: Colors.orange, fontSize: 9)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _viewTeamRoster(String teamId) async {
    try {
      final res = await ApiClient()
          .dio
          .get('/api/betting/cricket/fantasy/team/$teamId');
      final players = res.data['players'] as List<dynamic>;
      final team = res.data['team'];
      if (!mounted) return;
      _showCreatedTeamPreview(context, team, players);
    } catch (_) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Could not fetch player details for this team'),
        backgroundColor: AppColors.red,
      ));
    }
  }

  void _showCreatedTeamPreview(
      BuildContext context, dynamic team, List<dynamic> players) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) {
        final wk = players.where((p) => p['role'] == 'wicket_keeper').toList();
        final bat = players.where((p) => p['role'] == 'batsman').toList();
        final ar = players.where((p) => p['role'] == 'all_rounder').toList();
        final bowl = players.where((p) => p['role'] == 'bowler').toList();
        final capId = team['captain_id'];
        final vcId = team['vice_captain_id'];

        return Container(
          height: MediaQuery.of(context).size.height * 0.82,
          decoration: const BoxDecoration(
            color: Color(0xFF0F2B14),
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(16),
                decoration: const BoxDecoration(
                  color: Colors.black26,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Roster Composition',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 14)),
                    IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Stack(
                  children: [
                    Container(
                      width: double.infinity,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [
                            Colors.green.shade900,
                            Colors.green.shade800,
                            Colors.green.shade900,
                          ],
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        width: MediaQuery.of(context).size.width * 0.88,
                        height: MediaQuery.of(context).size.height * 0.68,
                        decoration: BoxDecoration(
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.18),
                              width: 1.5),
                          borderRadius: BorderRadius.all(
                            Radius.elliptical(
                                MediaQuery.of(context).size.width * 0.44,
                                MediaQuery.of(context).size.height * 0.34),
                          ),
                        ),
                      ),
                    ),
                    Center(
                      child: Container(
                        width: 48,
                        height: 120,
                        decoration: BoxDecoration(
                          color:
                              const Color(0xFFDFD1B0).withValues(alpha: 0.55),
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.3),
                              width: 1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                    Column(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _buildRow(bowl, capId, vcId),
                        _buildRow(ar, capId, vcId),
                        _buildRow(bat, capId, vcId),
                        _buildRow(wk, capId, vcId),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildRow(List<dynamic> list, String capId, String vcId) {
    if (list.isEmpty) return Container();
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: list.map((p) {
        final isC = capId == p['id'];
        final isVC = vcId == p['id'];
        final short = p['name'] != null
            ? (p['name'].toString().split(' ').last)
            : 'Player';

        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Column(
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.black87,
                      border: Border.all(color: AppColors.gold, width: 1),
                      image: p['avatar_url'] != null
                          ? DecorationImage(
                              image: NetworkImage(p['avatar_url']),
                              fit: BoxFit.cover,
                            )
                          : null,
                    ),
                    child: p['avatar_url'] == null
                        ? const Center(
                            child: Icon(Icons.sports_cricket,
                                color: Colors.white70, size: 16),
                          )
                        : null,
                  ),
                  if (isC || isVC)
                    Positioned(
                      right: 0,
                      top: 0,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: isC ? AppColors.gold : Colors.white,
                          shape: BoxShape.circle,
                        ),
                        child: Text(
                          isC ? 'C' : 'VC',
                          style: const TextStyle(
                              color: Colors.black,
                              fontWeight: FontWeight.bold,
                              fontSize: 7),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 4),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 4, vertical: 1.5),
                decoration: BoxDecoration(
                  color: Colors.black87,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  short,
                  style: const TextStyle(color: Colors.white, fontSize: 8),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}

// =============================================================================
// HISTORY TAB (SESSION/FANCY BET HISTORY)
// =============================================================================

class _HistoryTab extends StatefulWidget {
  const _HistoryTab();

  @override
  State<_HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<_HistoryTab> {
  List<dynamic> _bets = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res =
          await ApiClient().dio.get('/api/betting/cricket/session/my-bets');
      if (!mounted) return;
      setState(() {
        _bets = res.data['bets'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  double _n(dynamic v) => double.tryParse(v?.toString() ?? '0') ?? 0;

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(
          child: CircularProgressIndicator(color: AppColors.gold));
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      child: _bets.isEmpty
          ? ListView(children: const [
              Padding(
                padding: EdgeInsets.only(top: 80),
                child: Center(
                    child: Text('No session bets yet',
                        style: TextStyle(color: AppColors.textSecondary))),
              ),
            ])
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _bets.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final b = _bets[i];
                final status = b['status'] as String? ?? 'pending';
                final payout = _n(b['payout']);
                final color = switch (status) {
                  'won' => AppColors.green,
                  'lost' => AppColors.red,
                  'void' => Colors.orange,
                  _ => AppColors.textSecondary,
                };
                return Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: AppColors.cardBg,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: color.withValues(alpha: 0.4)),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${b['team_a']} v ${b['team_b']}',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700, fontSize: 14)),
                            const SizedBox(height: 3),
                            Text(
                              '${b['session_label']} → ${(b['selection'] as String? ?? '').toUpperCase()} [${b['runs_bracket']}] · ₹${_n(b['amount'])}',
                              style: const TextStyle(
                                  color: AppColors.textSecondary, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                                color: color.withValues(alpha: 0.18),
                                borderRadius: BorderRadius.circular(8)),
                            child: Text(status.toUpperCase(),
                                style: TextStyle(
                                    color: color,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold)),
                          ),
                          if (status == 'won' || status == 'void') ...[
                            const SizedBox(height: 4),
                            Text('+₹${payout.toStringAsFixed(0)}',
                                style: TextStyle(
                                    color: color,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 13)),
                          ],
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
    );
  }
}

// =============================================================================
// LIVE MATCH CENTER SCREEN (LIVE BETTING & SCORES)
// =============================================================================

class _LiveMatchCenterScreen extends StatefulWidget {
  final dynamic match;
  const _LiveMatchCenterScreen({required this.match});

  @override
  State<_LiveMatchCenterScreen> createState() => _LiveMatchCenterScreenState();
}

class _LiveMatchCenterScreenState extends State<_LiveMatchCenterScreen> {
  Map<String, dynamic> _liveData = {};
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient()
          .dio
          .get('/api/betting/cricket/matches/${widget.match['id']}/live');
      if (!mounted) return;
      setState(() {
        _liveData = res.data;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(child: CircularProgressIndicator(color: AppColors.gold)),
      );
    }

    final m = _liveData['match'] ?? widget.match;
    final score = m['live_score'] as Map<String, dynamic>?;
    final performances = ((_liveData['player_performances'] as List?) ?? [])
        .where((p) => (p['fantasy_points'] as num?) != null)
        .toList()
      ..sort((a, b) => (b['fantasy_points'] as num? ?? 0)
          .compareTo(a['fantasy_points'] as num? ?? 0));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('${m['team_a_short']} vs ${m['team_b_short']} live center',
            style: const TextStyle(fontSize: 16)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          )
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Live Scoreboard Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.red.withValues(alpha: 0.5)),
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(m['series'] ?? 'Live Match',
                        style: const TextStyle(
                            color: AppColors.textSecondary,
                            fontSize: 11,
                            fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      color: AppColors.red,
                      child: const Text('LIVE',
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Text(m['team_a_short'] ?? 'TMA',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900)),
                    Text(
                      score != null && score.containsKey('runs')
                          ? '${score['runs']}/${score['wickets']}'
                          : '0/0',
                      style: const TextStyle(
                          color: AppColors.gold,
                          fontSize: 24,
                          fontWeight: FontWeight.w900),
                    ),
                    Text(m['team_b_short'] ?? 'TMB',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900)),
                  ],
                ),
                if (score != null && score.containsKey('overs'))
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text('Overs: ${score['overs']}',
                        style: const TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ),
                if (score != null && score.containsKey('description'))
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      score['description'] ?? '',
                      style: const TextStyle(
                          color: AppColors.goldLight,
                          fontSize: 11,
                          fontStyle: FontStyle.italic),
                      textAlign: TextAlign.center,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          // Live fantasy points — auto-computed server-side from the live
          // scorecard every ~2 minutes while the match is live (Dream11-style).
          Row(
            children: [
              const Text('Live Fantasy Points',
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                      fontSize: 14)),
              const Spacer(),
              Text('updates every ~2 min',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 10)),
            ],
          ),
          const SizedBox(height: 8),
          if (performances.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(
                  'No live points yet — they appear once the match is underway.',
                  style: TextStyle(color: AppColors.textSecondary)),
            )
          else
            ...performances.take(15).map((p) => _LivePlayerPointsRow(p: p)),
          const SizedBox(height: 20),
          // Session (Fancy) betting — e.g. "6 Over Session - India".
          const Text('Session bets',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 14)),
          const SizedBox(height: 8),
          if ((_liveData['sessions'] as List?)?.where((s) => s['status'] == 'open').isEmpty ?? true)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('No session brackets open.',
                  style: TextStyle(color: AppColors.textSecondary)),
            )
          else
            ...(_liveData['sessions'] as List)
                .where((s) => s['status'] == 'open')
                .map((s) => _SessionRow(match: m, session: s)),
        ],
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  final dynamic match;
  final dynamic session;
  const _SessionRow({required this.match, required this.session});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.01),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 2,
            child: Text(
              session['label'] ?? '',
              style: const TextStyle(color: Colors.white70, fontSize: 11),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _placeSessionBet(context, 'yes'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.green.withValues(alpha: 0.15),
                foregroundColor: AppColors.green,
                side: const BorderSide(color: AppColors.green, width: 0.5),
                padding: const EdgeInsets.symmetric(vertical: 6),
              ),
              child: Text(
                'YES (${session['odds_yes']}x)\n[${session['max_runs']} runs]',
                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _placeSessionBet(context, 'no'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.red.withValues(alpha: 0.15),
                foregroundColor: AppColors.red,
                side: const BorderSide(color: AppColors.red, width: 0.5),
                padding: const EdgeInsets.symmetric(vertical: 6),
              ),
              child: Text(
                'NO (${session['odds_no']}x)\n[${session['min_runs']} runs]',
                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _placeSessionBet(BuildContext context, String selection) {
    final txt = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) {
        return AlertDialog(
          backgroundColor: AppColors.surface,
          title: Text('Session: ${selection.toUpperCase()}',
              style: const TextStyle(color: Colors.white, fontSize: 14)),
          content: TextField(
            controller: txt,
            keyboardType: TextInputType.number,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              hintText: 'Enter stake amount in ₹',
              hintStyle: TextStyle(color: AppColors.textSecondary),
              enabledBorder: UnderlineInputBorder(
                  borderSide: BorderSide(color: AppColors.gold)),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel', style: TextStyle(color: Colors.white)),
            ),
            ElevatedButton(
              onPressed: () async {
                final amt = double.tryParse(txt.text);
                if (amt == null || amt <= 0) return;
                try {
                  await ApiClient()
                      .dio
                      .post('/api/betting/cricket/session/bet', data: {
                    'session_id': session['id'],
                    'selection': selection,
                    'amount': amt,
                  });
                  SoundService.instance.play(Sfx.chipBet);
                  if (ctx.mounted) {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Session bet accepted! 🏏'),
                      backgroundColor: AppColors.green,
                    ));
                  }
                } catch (e) {
                  if (ctx.mounted) {
                    Navigator.pop(ctx);
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                      content: Text('Insufficient balance or closed session'),
                      backgroundColor: AppColors.red,
                    ));
                  }
                }
              },
              style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
              child: const Text('Submit Bet',
                  style: TextStyle(color: Colors.black)),
            ),
          ],
        );
      },
    );
  }
}

// Live per-player fantasy points row (auto-scored, no betting action here).
class _LivePlayerPointsRow extends StatelessWidget {
  final dynamic p;
  const _LivePlayerPointsRow({required this.p});

  @override
  Widget build(BuildContext context) {
    final points = (p['fantasy_points'] as num?)?.toDouble() ?? 0;
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.02),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p['name'] ?? '',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 12)),
                Text(
                    '${p['team_name'] ?? ''} · ${p['runs_scored'] ?? 0} runs · ${p['wickets'] ?? 0} wkts',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 10)),
              ],
            ),
          ),
          Text(points.toStringAsFixed(1),
              style: const TextStyle(
                  color: AppColors.gold,
                  fontWeight: FontWeight.w900,
                  fontSize: 16)),
        ],
      ),
    );
  }
}
