import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_api.dart';
import '../data/cricket_models.dart';

class HistoryTab extends StatefulWidget {
  const HistoryTab({super.key});

  @override
  State<HistoryTab> createState() => _HistoryTabState();
}

class _HistoryTabState extends State<HistoryTab> {
  final _api = CricketApi();
  List<OddsBetRecord> _oddsBets = [];
  List<SessionBetRecord> _sessionBets = [];
  bool _loading = true;
  int _activeType = 0; // 0 = Odds Bets, 1 = Session Bets

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      if (_activeType == 0) {
        final bets = await _api.fetchOddsBetHistory();
        if (!mounted) return;
        setState(() {
          _oddsBets = bets;
          _loading = false;
        });
      } else {
        final bets = await _api.fetchSessionBetHistory();
        if (!mounted) return;
        setState(() {
          _sessionBets = bets;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              ChoiceChip(
                label: const Text('Match Winner Bets'),
                selected: _activeType == 0,
                onSelected: (val) {
                  if (val) {
                    setState(() => _activeType = 0);
                    _load();
                  }
                },
                selectedColor: AppColors.pitchGreenLight.withValues(alpha: 0.22),
                checkmarkColor: AppColors.pitchGreenLight,
                labelStyle: TextStyle(
                  color: _activeType == 0 ? AppColors.pitchGreenLight : AppColors.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(width: 12),
              ChoiceChip(
                label: const Text('Session Brackets'),
                selected: _activeType == 1,
                onSelected: (val) {
                  if (val) {
                    setState(() => _activeType = 1);
                    _load();
                  }
                },
                selectedColor: AppColors.pitchGreenLight.withValues(alpha: 0.22),
                checkmarkColor: AppColors.pitchGreenLight,
                labelStyle: TextStyle(
                  color: _activeType == 1 ? AppColors.pitchGreenLight : AppColors.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: AppColors.gold))
              : RefreshIndicator(
                  onRefresh: _load,
                  color: AppColors.gold,
                  child: _activeType == 0 ? _buildOddsBetsList() : _buildSessionBetsList(),
                ),
        ),
      ],
    );
  }

  Widget _buildOddsBetsList() {
    if (_oddsBets.isEmpty) {
      return ListView(children: const [
        Padding(
          padding: EdgeInsets.only(top: 80),
          child: Center(child: Text('No match bets yet', style: TextStyle(color: AppColors.textSecondary))),
        ),
      ]);
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _oddsBets.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final b = _oddsBets[i];
        final color = _getStatusColor(b.status);
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
                    Text('${b.teamA} vs ${b.teamB}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: Colors.white)),
                    const SizedBox(height: 4),
                    Text('${b.marketLabel} · selection: ${b.optionLabel}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                    const SizedBox(height: 2),
                    Text('Stake: ₹${b.amount} · Odds: ${b.odds.toStringAsFixed(2)}x', style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(8)),
                    child: Text(b.status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                  if (b.status == 'won' || b.status == 'void') ...[
                    const SizedBox(height: 4),
                    Text('+₹${b.payout.toStringAsFixed(0)}', style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSessionBetsList() {
    if (_sessionBets.isEmpty) {
      return ListView(children: const [
        Padding(
          padding: EdgeInsets.only(top: 80),
          child: Center(child: Text('No session bets yet', style: TextStyle(color: AppColors.textSecondary))),
        ),
      ]);
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: _sessionBets.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (_, i) {
        final b = _sessionBets[i];
        final color = _getStatusColor(b.status);
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
                    Text('${b.teamA} v ${b.teamB}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14, color: Colors.white)),
                    const SizedBox(height: 3),
                    Text('${b.sessionLabel} → ${b.selection.toUpperCase()} [${b.runsBracket}] · ₹${b.amount}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(color: color.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(8)),
                    child: Text(b.status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
                  ),
                  if (b.status == 'won' || b.status == 'void') ...[
                    const SizedBox(height: 4),
                    Text('+₹${b.payout.toStringAsFixed(0)}', style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 13)),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Color _getStatusColor(String status) {
    return switch (status.toLowerCase()) {
      'won' => AppColors.pitchGreenLight,
      'lost' => AppColors.red,
      'void' => Colors.orange,
      _ => AppColors.textSecondary,
    };
  }
}
