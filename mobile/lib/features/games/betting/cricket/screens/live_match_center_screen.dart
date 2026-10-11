import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../../core/audio/sound_service.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_api.dart';
import '../data/cricket_models.dart';

class LiveMatchCenterScreen extends StatefulWidget {
  final CricketMatch match;
  const LiveMatchCenterScreen({super.key, required this.match});

  @override
  State<LiveMatchCenterScreen> createState() => _LiveMatchCenterScreenState();
}

class _LiveMatchCenterScreenState extends State<LiveMatchCenterScreen> {
  final _api = CricketApi();
  LiveMatchData? _data;
  bool _loading = true;
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _load();
    _refreshTimer = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await _api.fetchLiveMatch(widget.match);
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _data == null) {
      return const Scaffold(backgroundColor: AppColors.background, body: Center(child: CircularProgressIndicator(color: AppColors.gold)));
    }

    final m = _data!.match;
    final score = m.liveScore;
    final markets = m.markets;
    final openSessions = _data!.sessions.where((s) => s.status == 'open').toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('${m.teamAShort} vs ${m.teamBShort} Live Center', style: const TextStyle(fontSize: 16)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [AppColors.stadiumNavy, AppColors.surface]),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.red.withValues(alpha: 0.5)),
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(m.series, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      color: AppColors.red,
                      child: const Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold)),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Text(m.teamAShort, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
                    Text(score.hasScore ? '${score.runs}/${score.wickets}' : '0/0', style: const TextStyle(color: AppColors.gold, fontSize: 24, fontWeight: FontWeight.w900)),
                    Text(m.teamBShort, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
                  ],
                ),
                if (score.overs != null)
                  Padding(padding: const EdgeInsets.only(top: 8), child: Text('Overs: ${score.overs}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12))),
                if (score.description != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(score.description!, style: const TextStyle(color: AppColors.floodlight, fontSize: 11, fontStyle: FontStyle.italic), textAlign: TextAlign.center),
                  ),
                (() {
                  final raw = score.raw;
                  final target = raw['target'];
                  final runsReq = raw['runs_required'];
                  final ballsLeft = raw['balls_remaining'];
                  
                  if (target == null && runsReq == null) return const SizedBox();
                  return Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (target != null)
                            Text('Target: $target', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
                          if (target != null && runsReq != null)
                            const Text('  |  ', style: TextStyle(color: Colors.white24, fontSize: 11)),
                          if (runsReq != null && ballsLeft != null)
                            Text('Need $runsReq runs off $ballsLeft balls', style: const TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold))
                          else if (runsReq != null)
                            Text('Need $runsReq runs to win', style: const TextStyle(color: AppColors.gold, fontSize: 11, fontWeight: FontWeight.bold)),
                        ],
                      ),
                    ),
                  );
                })(),
              ],
            ),
          ),
          const SizedBox(height: 20),
          const Text('Live Match Winner Odds', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 8),
          if (markets.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('No live odds available at this moment.', style: TextStyle(color: AppColors.textSecondary)),
            )
          else
            ...markets.map((mkt) => _LiveOddsMarketRow(api: _api, market: mkt)),
          const SizedBox(height: 20),
          const Text('Session Brackets', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
          const SizedBox(height: 8),
          if (openSessions.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('No session brackets open.', style: TextStyle(color: AppColors.textSecondary)))
          else
            ...openSessions.map((s) => _SessionRow(api: _api, session: s)),
        ],
      ),
    );
  }
}

class _LiveOddsMarketRow extends StatelessWidget {
  final CricketApi api;
  final OddsMarket market;
  const _LiveOddsMarketRow({required this.api, required this.market});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(market.label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
          const SizedBox(height: 10),
          Row(
            children: market.options.map((opt) => Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: ElevatedButton(
                  onPressed: () => _placeBet(context, opt),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold.withValues(alpha: 0.12),
                    foregroundColor: AppColors.gold,
                    side: const BorderSide(color: AppColors.gold, width: 0.5),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                  ),
                  child: Text(
                    '${opt.label}\n${opt.odds.toStringAsFixed(2)}x',
                    style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
            )).toList(),
          ),
        ],
      ),
    );
  }

  void _placeBet(BuildContext context, OddsMarketOption option) {
    final txt = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Place Bet on ${option.label}', style: const TextStyle(color: Colors.white, fontSize: 14)),
        content: TextField(
          controller: txt,
          keyboardType: TextInputType.number,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: 'Enter stake amount in ₹',
            hintStyle: TextStyle(color: AppColors.textSecondary),
            enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.gold)),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: Colors.white))),
          ElevatedButton(
            onPressed: () async {
              final amt = double.tryParse(txt.text);
              if (amt == null || amt <= 0) return;
              try {
                await api.placeOddsBet(marketId: market.id, optionKey: option.key, amount: amt);
                SoundService.instance.play(Sfx.chipBet);
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Bet placed successfully! 🏆'), backgroundColor: AppColors.pitchGreen));
                }
              } catch (err) {
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err.toString()), backgroundColor: AppColors.red));
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
            child: const Text('Confirm Bet', style: TextStyle(color: Colors.black)),
          ),
        ],
      ),
    );
  }
}

class _SessionRow extends StatelessWidget {
  final CricketApi api;
  final SessionMarket session;
  const _SessionRow({required this.api, required this.session});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: AppColors.pitchGreen.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(8)),
      child: Row(
        children: [
          Expanded(flex: 2, child: Text(session.label, style: const TextStyle(color: Colors.white70, fontSize: 11))),
          const SizedBox(width: 8),
          Expanded(
            child: ElevatedButton(
              onPressed: () => _placeSessionBet(context, 'yes'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.pitchGreen.withValues(alpha: 0.15),
                foregroundColor: AppColors.pitchGreenLight,
                side: const BorderSide(color: AppColors.pitchGreenLight, width: 0.5),
                padding: const EdgeInsets.symmetric(vertical: 6),
              ),
              child: Text('YES (${session.oddsYes}x)\n[${session.maxRuns} runs]', style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
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
              child: Text('NO (${session.oddsNo}x)\n[${session.minRuns} runs]', style: const TextStyle(fontSize: 9, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
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
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Session: ${selection.toUpperCase()}', style: const TextStyle(color: Colors.white, fontSize: 14)),
        content: TextField(
          controller: txt,
          keyboardType: TextInputType.number,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: 'Enter stake amount in ₹',
            hintStyle: TextStyle(color: AppColors.textSecondary),
            enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: AppColors.gold)),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel', style: TextStyle(color: Colors.white))),
          ElevatedButton(
            onPressed: () async {
              final amt = double.tryParse(txt.text);
              if (amt == null || amt <= 0) return;
              try {
                await api.placeSessionBet(sessionId: session.id, selection: selection, amount: amt);
                SoundService.instance.play(Sfx.chipBet);
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Session bet accepted! 🏏'), backgroundColor: AppColors.pitchGreen));
                }
              } catch (_) {
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Insufficient balance or closed session'), backgroundColor: AppColors.red));
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.gold),
            child: const Text('Submit Bet', style: TextStyle(color: Colors.black)),
          ),
        ],
      ),
    );
  }
}
