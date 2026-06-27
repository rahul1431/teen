import 'package:flutter/material.dart';
import '../../../core/audio/sound_service.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';
import 'betting_history_page.dart';

/// Premium Cricket Hub — Lobby | Match Center | Fantasy | My Teams
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
    try {
      final res = await ApiClient().dio.get('/api/betting/cricket/matches');
      if (!mounted) return;
      setState(() {
        _matches = res.data['matches'] ?? [];
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
        title: const Text('Cricket',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
        actions: [
          IconButton(
            icon: const Icon(Icons.receipt_long_rounded),
            tooltip: 'My Bets',
            onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(
                    builder: (_) =>
                        const BettingHistoryPage(type: BettingType.cricket))),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.gold,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          tabs: const [
            Tab(text: 'Lobby'),
            Tab(text: 'Live'),
            Tab(text: 'Fantasy'),
            Tab(text: 'My Teams'),
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
                _LiveTab(
                    matches: _matches
                        .where((m) => m['status'] == 'live')
                        .toList()),
                _FantasyTab(matches: _matches),
                _MyTeamsTab(),
              ],
            ),
    );
  }
}

// =============================================================================
// LOBBY TAB
// =============================================================================

class _LobbyTab extends StatelessWidget {
  final List<dynamic> matches;
  final VoidCallback onRefresh;
  const _LobbyTab({required this.matches, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => onRefresh(),
      color: AppColors.gold,
      child: matches.isEmpty
          ? const Center(
              child: Text('No matches available',
                  style: TextStyle(color: AppColors.textSecondary)))
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 80),
              itemCount: matches.length,
              itemBuilder: (_, i) => _MatchCard(match: matches[i]),
            ),
    );
  }
}

class _MatchCard extends StatelessWidget {
  final dynamic match;
  const _MatchCard({required this.match});

  @override
  Widget build(BuildContext context) {
    final isLive = match['status'] == 'live';
    final score = match['live_score'] as Map<String, dynamic>?;
    final markets = (match['markets'] as List?) ?? [];
    final sessions = (match['sessions'] as List?) ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isLive
              ? AppColors.red.withOpacity(0.8)
              : AppColors.green.withOpacity(0.3),
          width: isLive ? 1.5 : 1,
        ),
      ),
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: isLive
                  ? AppColors.red.withOpacity(0.12)
                  : Colors.white.withOpacity(0.03),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (match['series'] != null)
                        Text('${match['series']}',
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 10)),
                      Text('${match['team_a']}  vs  ${match['team_b']}',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 14)),
                      if (match['starts_at'] != null)
                        Text(_fmt(match['starts_at']),
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 10)),
                    ],
                  ),
                ),
                if (isLive)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                        color: AppColors.red,
                        borderRadius: BorderRadius.circular(6)),
                    child: const Text('LIVE',
                        style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                            fontSize: 10)),
                  ),
                if (score != null && score.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Text(
                    '${score['runs'] ?? 0}/${score['wickets'] ?? 0}',
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 13),
                  ),
                ],
              ],
            ),
          ),

          // Markets
          if (markets.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: markets
                    .where((mk) =>
                        mk['status'] == null || mk['status'] == 'open')
                    .map<Widget>((mk) => _MarketRow(match: match, market: mk))
                    .toList(),
              ),
            ),

          // Sessions (Fancy)
          if (sessions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Divider(color: Colors.white10),
                  const Text('Sessions (Fancy)',
                      style: TextStyle(
                          color: AppColors.gold,
                          fontSize: 12,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 6),
                  ...sessions.map((s) => _SessionRow(match: match, session: s)).toList(),
                ],
              ),
            ),
        ],
      ),
    );
  }

  String _fmt(dynamic iso) {
    final dt = DateTime.tryParse(iso?.toString() ?? '');
    if (dt == null) return '';
    final l = dt.toLocal();
    return '${l.day}/${l.month}  ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }
}

class _SessionRow extends StatelessWidget {
  final dynamic match;
  final dynamic session;
  const _SessionRow({required this.match, required this.session});

  @override
  Widget build(BuildContext context) {
    final label = session['label'] ?? session['name'] ?? 'Session';
    final yesOdds = session['yes_odds'] ?? session['yes'] ?? '-';
    final noOdds = session['no_odds'] ?? session['no'] ?? '-';

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(label,
                style: const TextStyle(
                    color: Colors.white70, fontSize: 11)),
          ),
          GestureDetector(
            onTap: () => _showSessionBetSheet(context, true),
            child: Container(
              width: 56,
              padding:
                  const EdgeInsets.symmetric(vertical: 6),
              margin: const EdgeInsets.only(right: 6),
              decoration: BoxDecoration(
                color: AppColors.green.withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                    color: AppColors.green.withOpacity(0.5)),
              ),
              child: Column(
                children: [
                  const Text('YES',
                      style: TextStyle(
                          color: AppColors.green,
                          fontSize: 9,
                          fontWeight: FontWeight.bold)),
                  Text('$yesOdds',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
          GestureDetector(
            onTap: () => _showSessionBetSheet(context, false),
            child: Container(
              width: 56,
              padding:
                  const EdgeInsets.symmetric(vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.red.withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                    color: AppColors.red.withOpacity(0.5)),
              ),
              child: Column(
                children: [
                  const Text('NO',
                      style: TextStyle(
                          color: AppColors.red,
                          fontSize: 9,
                          fontWeight: FontWeight.bold)),
                  Text('$noOdds',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showSessionBetSheet(BuildContext context, bool isYes) {
    double amount = 50;
    bool submitting = false;
    String? error;
    final odds = double.tryParse(
            (isYes
                    ? session['yes_odds'] ?? session['yes']
                    : session['no_odds'] ?? session['no'])
                ?.toString() ??
                '1') ??
        1;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius:
              BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(2))),
              ),
              const SizedBox(height: 16),
              Text(
                '${match['team_a']} vs ${match['team_b']}',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 4),
              Text(
                  '${session['label'] ?? session['name']} — ${isYes ? 'YES' : 'NO'}',
                  style: const TextStyle(
                      color: AppColors.textSecondary)),
              const SizedBox(height: 4),
              Row(children: [
                const Text('Odds: ',
                    style: TextStyle(
                        color: AppColors.textSecondary)),
                Text('${odds}x',
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 18)),
              ]),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children:
                    [50, 100, 250, 500, 1000, 2000].map((v) {
                  return GestureDetector(
                    onTap: () =>
                        setSheet(() => amount = v.toDouble()),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: amount == v.toDouble()
                            ? AppColors.gold
                            : AppColors.cardBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: amount == v.toDouble()
                                ? AppColors.gold
                                : Colors.white12),
                      ),
                      child: Text('Rs.$v',
                          style: TextStyle(
                              color: amount == v.toDouble()
                                  ? Colors.black
                                  : Colors.white,
                              fontWeight: FontWeight.bold)),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 14),
              Row(
                  mainAxisAlignment:
                      MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Potential Return:',
                        style: TextStyle(
                            color: AppColors.textSecondary)),
                    Text('Rs.${(amount * odds).toStringAsFixed(0)}',
                        style: const TextStyle(
                            color: AppColors.goldLight,
                            fontSize: 18,
                            fontWeight: FontWeight.bold)),
                  ]),
              if (error != null) ...[
                const SizedBox(height: 8),
                Text(error!,
                    style: const TextStyle(color: AppColors.red)),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: submitting
                      ? null
                      : () async {
                          setSheet(() {
                            submitting = true;
                            error = null;
                          });
                          try {
                            await ApiClient().dio.post(
                                '/api/betting/cricket/session-bet',
                                data: {
                                  'session_id': session['id'],
                                  'is_yes': isYes,
                                  'amount': amount,
                                });
                            SoundService.instance
                                .play(Sfx.chipBet);
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                          } catch (e) {
                            setSheet(() {
                              submitting = false;
                              error =
                                  e.toString().contains('Insufficient')
                                      ? 'Insufficient balance'
                                      : 'Could not place bet';
                            });
                          }
                        },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: isYes
                          ? AppColors.green
                          : AppColors.red,
                      padding: const EdgeInsets.symmetric(
                          vertical: 16),
                      shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(12))),
                  child: Text(
                      submitting
                          ? 'Placing...'
                          : 'Bet ${isYes ? 'YES' : 'NO'} — Rs.${amount.toInt()}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MarketRow extends StatelessWidget {
  final dynamic match;
  final dynamic market;
  const _MarketRow({required this.match, required this.market});

  @override
  Widget build(BuildContext context) {
    final options = (market['options'] as List?) ?? [];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(market['label'] ?? '',
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 11)),
          const SizedBox(height: 4),
          Row(
            children: options.map<Widget>((o) {
              return Expanded(
                child: GestureDetector(
                  onTap: () {
                    SoundService.instance.play(Sfx.buttonTap);
                    _showBetSheet(context, match, market, o);
                  },
                  child: Container(
                    margin: const EdgeInsets.only(right: 6),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                          color: AppColors.gold.withOpacity(0.4)),
                    ),
                    child: Column(
                      children: [
                        Text(o['label'] ?? '',
                            style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w600),
                            textAlign: TextAlign.center),
                        Text('${o['odds']}x',
                            style: const TextStyle(
                                color: AppColors.goldLight,
                                fontSize: 12,
                                fontWeight: FontWeight.bold)),
                      ],
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

  void _showBetSheet(
      BuildContext context, dynamic match, dynamic market, dynamic option) {
    double amount = 50;
    bool submitting = false;
    String? error;
    final odds = double.tryParse(option['odds'].toString()) ?? 1;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: MediaQuery.of(ctx).viewInsets.bottom + 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                  child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 16),
              Text(
                  '${match['team_a']} vs ${match['team_b']}',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text('${market['label']} → ${option['label']}',
                  style: const TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 4),
              Row(children: [
                const Text('Odds: ',
                    style: TextStyle(color: AppColors.textSecondary)),
                Text('${option['odds']}x',
                    style: const TextStyle(
                        color: AppColors.gold,
                        fontWeight: FontWeight.bold,
                        fontSize: 18)),
              ]),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [50, 100, 250, 500, 1000, 2000].map((v) {
                  return GestureDetector(
                    onTap: () => setSheet(() => amount = v.toDouble()),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: amount == v.toDouble()
                            ? AppColors.gold
                            : AppColors.cardBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: amount == v.toDouble()
                                ? AppColors.gold
                                : Colors.white12),
                      ),
                      child: Text('₹$v',
                          style: TextStyle(
                              color: amount == v.toDouble()
                                  ? Colors.black
                                  : Colors.white,
                              fontWeight: FontWeight.bold)),
                    ),
                  );
                }).toList(),
              ),
              const SizedBox(height: 14),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Potential Return:',
                      style: TextStyle(color: AppColors.textSecondary)),
                  Text('₹${(amount * odds).toStringAsFixed(0)}',
                      style: const TextStyle(
                          color: AppColors.goldLight,
                          fontSize: 18,
                          fontWeight: FontWeight.bold)),
                ],
              ),
              if (error != null) ...[
                const SizedBox(height: 8),
                Text(error!,
                    style: const TextStyle(color: AppColors.red)),
              ],
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: submitting
                      ? null
                      : () async {
                          setSheet(
                              () { submitting = true; error = null; });
                          try {
                            await ApiClient().dio.post(
                                '/api/betting/cricket/bet',
                                data: {
                                  'market_id': market['id'],
                                  'option_key': option['key'],
                                  'amount': amount,
                                });
                            SoundService.instance.play(Sfx.chipBet);
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                    content: Text('Bet Placed!'),
                                    backgroundColor: AppColors.green));
                          } catch (e) {
                            setSheet(() {
                              submitting = false;
                              error = e
                                      .toString()
                                      .contains('Insufficient')
                                  ? 'Insufficient balance'
                                  : 'Could not place bet';
                            });
                          }
                        },
                  style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      padding:
                          const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12))),
                  child: Text(
                      submitting
                          ? 'Placing...'
                          : 'Place Bet Rs.${amount.toInt()}',
                      style: const TextStyle(
                          color: Colors.black,
                          fontWeight: FontWeight.bold,
                          fontSize: 16)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// LIVE TAB
// =============================================================================

class _LiveTab extends StatelessWidget {
  final List<dynamic> matches;
  const _LiveTab({required this.matches});

  @override
  Widget build(BuildContext context) {
    if (matches.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.sports_cricket,
                color: AppColors.textSecondary, size: 48),
            SizedBox(height: 16),
            Text('No live matches right now',
                style: TextStyle(
                    color: AppColors.textSecondary, fontSize: 16)),
            SizedBox(height: 8),
            Text('Check Lobby for upcoming fixtures',
                style: TextStyle(
                    color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: matches.length,
      itemBuilder: (_, i) => _LiveMatchCenter(match: matches[i]),
    );
  }
}

class _LiveMatchCenter extends StatefulWidget {
  final dynamic match;
  const _LiveMatchCenter({required this.match});
  @override
  State<_LiveMatchCenter> createState() => _LiveMatchCenterState();
}

class _LiveMatchCenterState extends State<_LiveMatchCenter> {
  Map<String, dynamic>? _liveData;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadLive();
  }

  Future<void> _loadLive() async {
    try {
      final res = await ApiClient()
          .dio
          .get('/api/betting/cricket/matches/${widget.match['id']}/live');
      if (!mounted) return;
      setState(() {
        _liveData = Map<String, dynamic>.from(res.data);
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final m = widget.match;
    final score =
        (m['live_score'] as Map<String, dynamic>?) ?? {};
    final markets = (_liveData?['markets'] as List?) ??
        (m['markets'] as List?) ??
        [];
    final openMarkets =
        markets.where((mk) => mk['status'] == 'open').toList();

    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.red.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Container(
            padding: const EdgeInsets.all(16),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                  colors: [Color(0xFF8B0000), Color(0xFF1a1a2e)]),
              borderRadius:
                  BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${m['series']}',
                          style: TextStyle(
                              color: Colors.white.withOpacity(0.7),
                              fontSize: 11)),
                      Text('${m['team_a']}  vs  ${m['team_b']}',
                          style: const TextStyle(
                              color: Colors.white,
                              fontSize: 17,
                              fontWeight: FontWeight.w900)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                      color: AppColors.red,
                      borderRadius: BorderRadius.circular(8)),
                  child: const Text('LIVE',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 12)),
                ),
              ],
            ),
          ),

          // Scoreboard
          if (score.isNotEmpty)
            Container(
              padding: const EdgeInsets.all(16),
              color: const Color(0xFF0D0D1A),
              child: Column(
                children: [
                  Text(
                    '${score['runs'] ?? 0}/${score['wickets'] ?? 0}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 36,
                        fontWeight: FontWeight.w900),
                    textAlign: TextAlign.center,
                  ),
                  Text('${score['overs'] ?? 0} overs',
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
                  if (score['description'] != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Text(score['description'],
                          style: const TextStyle(
                              color: AppColors.goldLight, fontSize: 12),
                          textAlign: TextAlign.center),
                    ),
                ],
              ),
            ),

          // Live markets
          Padding(
            padding: const EdgeInsets.all(12),
            child: openMarkets.isEmpty
                ? const Text('No live markets open.',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 12))
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Live Markets',
                          style: TextStyle(
                              color: AppColors.gold,
                              fontWeight: FontWeight.bold,
                              fontSize: 13)),
                      const SizedBox(height: 8),
                      ...openMarkets.map<Widget>(
                          (mk) => _MarketRow(match: m, market: mk)),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// FANTASY TAB
// =============================================================================

class _FantasyTab extends StatefulWidget {
  final List<dynamic> matches;
  const _FantasyTab({required this.matches});
  @override
  State<_FantasyTab> createState() => _FantasyTabState();
}

class _FantasyTabState extends State<_FantasyTab> {
  dynamic _selectedMatch;
  List<dynamic> _players = [];
  List<dynamic> _leagues = [];
  bool _loadingPlayers = false;
  bool _loadingLeagues = false;

  final Set<String> _selectedIds = {};
  String? _captainId;
  String? _vcId;

  double get _totalCredits => _players
      .where((p) => _selectedIds.contains(p['id'] as String))
      .fold(0.0, (s, p) => s + (double.tryParse(p['credits'].toString()) ?? 0));

  Map<String, int> get _roleCounts {
    final sel =
        _players.where((p) => _selectedIds.contains(p['id'] as String)).toList();
    return {
      'wicket_keeper': sel.where((p) => p['role'] == 'wicket_keeper').length,
      'batsman': sel.where((p) => p['role'] == 'batsman').length,
      'all_rounder': sel.where((p) => p['role'] == 'all_rounder').length,
      'bowler': sel.where((p) => p['role'] == 'bowler').length,
    };
  }

  String? get _validationError {
    if (_selectedIds.length != 11)
      return 'Select exactly 11 players (${_selectedIds.length}/11)';
    if (_totalCredits > 100.0)
      return 'Over budget! ${_totalCredits.toStringAsFixed(1)}/100 cr';
    final rc = _roleCounts;
    if ((rc['wicket_keeper'] ?? 0) < 1) return 'Need at least 1 Wicket Keeper';
    if ((rc['batsman'] ?? 0) < 3) return 'Need at least 3 Batsmen';
    if ((rc['all_rounder'] ?? 0) < 1) return 'Need at least 1 All-Rounder';
    if ((rc['bowler'] ?? 0) < 3) return 'Need at least 3 Bowlers';
    if (_captainId == null) return 'Select a Captain (tap C)';
    if (_vcId == null) return 'Select a Vice-Captain (tap VC)';
    return null;
  }

  bool get _canJoin => _validationError == null;

  Future<void> _onMatchSelected(dynamic match) async {
    setState(() {
      _selectedMatch = match;
      _selectedIds.clear();
      _captainId = null;
      _vcId = null;
      _players = [];
      _leagues = [];
      _loadingPlayers = true;
      _loadingLeagues = true;
    });
    try {
      final results = await Future.wait([
        ApiClient()
            .dio
            .get('/api/betting/cricket/players?match_id=${match['id']}'),
        ApiClient().dio.get(
            '/api/betting/cricket/fantasy/leagues?match_id=${match['id']}'),
      ]);
      if (!mounted) return;
      setState(() {
        _players = results[0].data['players'] ?? [];
        _leagues = results[1].data['leagues'] ?? [];
        _loadingPlayers = false;
        _loadingLeagues = false;
      });
    } catch (_) {
      if (mounted)
        setState(() {
          _loadingPlayers = false;
          _loadingLeagues = false;
        });
    }
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
              content: Text('Max 11 players'),
              backgroundColor: AppColors.red));
          return;
        }
        final nc =
            _totalCredits + (double.tryParse(p['credits'].toString()) ?? 0);
        if (nc > 100.0) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
              content: Text('Over 100 credit budget!'),
              backgroundColor: AppColors.red));
          return;
        }
        _selectedIds.add(id);
      }
    });
  }

  Future<void> _joinLeague(dynamic league) async {
    if (!_canJoin) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(_validationError!),
          backgroundColor: AppColors.red));
      return;
    }
    try {
      final teamRes =
          await ApiClient().dio.post('/api/betting/cricket/fantasy/team', data: {
        'match_id': _selectedMatch['id'],
        'player_ids': _selectedIds.toList(),
        'captain_id': _captainId,
        'vice_captain_id': _vcId,
      });
      await ApiClient().dio.post('/api/betting/cricket/fantasy/join', data: {
        'league_id': league['id'],
        'team_id': teamRes.data['team_id'],
      });
      SoundService.instance.play(Sfx.chipBet);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Joined contest!'),
          backgroundColor: AppColors.green));
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString().contains('already joined')
          ? 'Already joined this contest'
          : 'Could not join';
      ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(msg), backgroundColor: AppColors.red));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Match selector
        Container(
          color: AppColors.surface,
          padding: const EdgeInsets.all(12),
          child: DropdownButton<String>(
            isExpanded: true,
            hint: const Text('Select match to draft for...',
                style: TextStyle(color: AppColors.textSecondary)),
            value: _selectedMatch?['id'] as String?,
            dropdownColor: AppColors.surface,
            style: const TextStyle(color: Colors.white),
            items: widget.matches
                .where((m) =>
                    m['status'] == 'upcoming' || m['status'] == 'live')
                .map<DropdownMenuItem<String>>((m) => DropdownMenuItem(
                      value: m['id'] as String,
                      child: Text(
                          '${m['team_a']} vs ${m['team_b']} (${m['series']})'),
                    ))
                .toList(),
            onChanged: (val) {
              final m = widget.matches
                  .firstWhere((m) => m['id'] == val);
              _onMatchSelected(m);
            },
          ),
        ),

        // Budget bar
        if (_selectedMatch != null)
          Container(
            color: const Color(0xFF0D0D1A),
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('${_selectedIds.length}/11',
                    style: const TextStyle(
                        color: Colors.white, fontWeight: FontWeight.bold)),
                const Spacer(),
                Text('${_totalCredits.toStringAsFixed(1)}/100 cr',
                    style: TextStyle(
                        color: _totalCredits > 100
                            ? AppColors.red
                            : AppColors.goldLight,
                        fontWeight: FontWeight.bold)),
                const SizedBox(width: 12),
                Text(
                  'WK:${_roleCounts['wicket_keeper']} BAT:${_roleCounts['batsman']} AR:${_roleCounts['all_rounder']} BWL:${_roleCounts['bowler']}',
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 10),
                ),
              ],
            ),
          ),

        // Players list
        Expanded(
          child: _selectedMatch == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text(
                        'Select a match above to start drafting your fantasy team.',
                        style: TextStyle(
                            color: AppColors.textSecondary, fontSize: 14),
                        textAlign: TextAlign.center),
                  ),
                )
              : _loadingPlayers
                  ? const Center(
                      child: CircularProgressIndicator(
                          color: AppColors.gold))
                  : _buildPlayerList(),
        ),

        // Join bar
        if (_selectedMatch != null) _buildLeagueJoinBar(),
      ],
    );
  }

  Widget _buildPlayerList() {
    const roles = [
      'wicket_keeper',
      'batsman',
      'all_rounder',
      'bowler'
    ];
    const roleLabels = {
      'wicket_keeper': 'Wicket Keepers',
      'batsman': 'Batsmen',
      'all_rounder': 'All-Rounders',
      'bowler': 'Bowlers',
    };

    return ListView(
      padding: const EdgeInsets.only(bottom: 180),
      children: roles.map((role) {
        final rp = _players.where((p) => p['role'] == role).toList();
        if (rp.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(roleLabels[role]!,
                  style: const TextStyle(
                      color: AppColors.gold,
                      fontWeight: FontWeight.bold,
                      fontSize: 13)),
            ),
            ...rp.map((p) => _PlayerTile(
                  player: p,
                  isSelected: _selectedIds.contains(p['id'] as String),
                  isCaptain: _captainId == p['id'],
                  isViceCaptain: _vcId == p['id'],
                  onTap: () => _togglePlayer(p),
                  onCaptain: () => setState(() {
                    if (_captainId == p['id']) {
                      _captainId = null;
                    } else {
                      if (_vcId == p['id']) _vcId = null;
                      _captainId = p['id'] as String;
                    }
                  }),
                  onVc: () => setState(() {
                    if (_vcId == p['id']) {
                      _vcId = null;
                    } else {
                      if (_captainId == p['id']) _captainId = null;
                      _vcId = p['id'] as String;
                    }
                  }),
                )),
          ],
        );
      }).toList(),
    );
  }

  Widget _buildLeagueJoinBar() {
    if (_loadingLeagues)
      return const LinearProgressIndicator(color: AppColors.gold);
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Join a Contest',
              style: TextStyle(
                  color: AppColors.gold,
                  fontWeight: FontWeight.bold,
                  fontSize: 13)),
          const SizedBox(height: 8),
          _leagues.isEmpty
              ? const Text('No contests created yet.',
                  style: TextStyle(color: AppColors.textSecondary))
              : SizedBox(
                  height: 80,
                  child: ListView.builder(
                    scrollDirection: Axis.horizontal,
                    itemCount: _leagues.length,
                    itemBuilder: (_, i) {
                      final l = _leagues[i];
                      final joined = l['joined_entry_id'] != null;
                      return GestureDetector(
                        onTap: joined ? null : () => _joinLeague(l),
                        child: Container(
                          width: 160,
                          margin: const EdgeInsets.only(right: 10),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: joined
                                ? AppColors.green.withOpacity(0.1)
                                : AppColors.cardBg,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                                color: joined
                                    ? AppColors.green
                                    : AppColors.gold.withOpacity(0.5)),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment:
                                MainAxisAlignment.spaceBetween,
                            children: [
                              Text(l['name'] ?? '',
                                  style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis),
                              Text(
                                  'Entry: Rs.${l['entry_fee']}  Prize: Rs.${l['prize_pool']}',
                                  style: const TextStyle(
                                      color: AppColors.goldLight,
                                      fontSize: 10)),
                              Text(
                                  joined
                                      ? 'Joined'
                                      : '${l['current_entries']}/${l['max_entries']} spots',
                                  style: TextStyle(
                                      color: joined
                                          ? AppColors.green
                                          : AppColors.textSecondary,
                                      fontSize: 10)),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
          if (_validationError != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text('Note: $_validationError',
                  style: const TextStyle(
                      color: Colors.orange, fontSize: 11)),
            ),
        ],
      ),
    );
  }
}

class _PlayerTile extends StatelessWidget {
  final dynamic player;
  final bool isSelected;
  final bool isCaptain;
  final bool isViceCaptain;
  final VoidCallback onTap;
  final VoidCallback onCaptain;
  final VoidCallback onVc;

  const _PlayerTile({
    required this.player,
    required this.isSelected,
    required this.isCaptain,
    required this.isViceCaptain,
    required this.onTap,
    required this.onCaptain,
    required this.onVc,
  });

  static const _roleColors = {
    'wicket_keeper': Color(0xFF9C27B0),
    'batsman': Color(0xFF1565C0),
    'all_rounder': Color(0xFF2E7D32),
    'bowler': Color(0xFFE65100),
  };
  static const _roleShorts = {
    'wicket_keeper': 'WK',
    'batsman': 'BAT',
    'all_rounder': 'AR',
    'bowler': 'BWL',
  };

  @override
  Widget build(BuildContext context) {
    final rc = _roleColors[player['role'] as String] ?? Colors.grey;
    final rs = _roleShorts[player['role'] as String] ?? '';

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        padding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? AppColors.cardBg
              : AppColors.surface.withOpacity(0.5),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected
                ? (isCaptain
                    ? AppColors.gold
                    : isViceCaptain
                        ? const Color(0xFFC0C0C0)
                        : AppColors.green)
                : Colors.white12,
            width: isSelected ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: isSelected ? rc : rc.withOpacity(0.3),
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(rs,
                    style: TextStyle(
                        color:
                            isSelected ? Colors.white : Colors.white54,
                        fontSize: 9,
                        fontWeight: FontWeight.bold)),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(player['name'] ?? '',
                      style: TextStyle(
                          color: isSelected
                              ? Colors.white
                              : Colors.white70,
                          fontWeight: FontWeight.w600,
                          fontSize: 13)),
                  Text(player['team_name'] ?? '',
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 10)),
                ],
              ),
            ),
            Text('${player['credits']} cr',
                style: TextStyle(
                    color: isSelected
                        ? AppColors.goldLight
                        : AppColors.textSecondary,
                    fontSize: 12,
                    fontWeight: FontWeight.bold)),
            if (isSelected) ...[
              const SizedBox(width: 8),
              Column(
                children: [
                  GestureDetector(
                    onTap: onCaptain,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isCaptain
                            ? AppColors.gold
                            : Colors.white12,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text('C',
                          style: TextStyle(
                              color: isCaptain
                                  ? Colors.black
                                  : Colors.white54,
                              fontSize: 10,
                              fontWeight: FontWeight.bold)),
                    ),
                  ),
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: onVc,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isViceCaptain
                            ? const Color(0xFFC0C0C0)
                            : Colors.white12,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text('VC',
                          style: TextStyle(
                              color: isViceCaptain
                                  ? Colors.black
                                  : Colors.white54,
                              fontSize: 9,
                              fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(width: 6),
            Icon(
              isSelected
                  ? Icons.check_circle
                  : Icons.add_circle_outline,
              color: isSelected ? AppColors.green : Colors.white24,
              size: 20,
            ),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// MY TEAMS TAB
// =============================================================================

class _MyTeamsTab extends StatefulWidget {
  @override
  State<_MyTeamsTab> createState() => _MyTeamsTabState();
}

class _MyTeamsTabState extends State<_MyTeamsTab> {
  List<dynamic> _bets = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res =
          await ApiClient().dio.get('/api/betting/cricket/my-bets');
      if (!mounted) return;
      setState(() {
        _bets = res.data['bets'] ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading)
      return const Center(
          child: CircularProgressIndicator(color: AppColors.gold));
    if (_bets.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.receipt_long,
                color: AppColors.textSecondary, size: 48),
            SizedBox(height: 16),
            Text('No bets placed yet',
                style: TextStyle(
                    color: AppColors.textSecondary, fontSize: 16)),
            SizedBox(height: 8),
            Text('Go to Lobby and place your first bet!',
                style: TextStyle(
                    color: AppColors.textSecondary, fontSize: 12)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: _bets.length,
        itemBuilder: (_, i) {
          final b = _bets[i];
          final statusColor = b['status'] == 'won'
              ? AppColors.green
              : b['status'] == 'lost'
                  ? AppColors.red
                  : AppColors.gold;
          return Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.cardBg,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                  color: statusColor.withOpacity(0.3)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                          '${b['team_a']} vs ${b['team_b']}',
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 13)),
                      const SizedBox(height: 2),
                      Text(
                          '${b['market_label']} > ${b['option_label']} @ ${b['odds']}x',
                          style: const TextStyle(
                              color: AppColors.textSecondary,
                              fontSize: 11)),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('Rs.${b['amount']}',
                        style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: statusColor),
                      ),
                      child: Text(
                          (b['status'] ?? '').toString().toUpperCase(),
                          style: TextStyle(
                              color: statusColor,
                              fontSize: 10,
                              fontWeight: FontWeight.bold)),
                    ),
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
