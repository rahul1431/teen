import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_models.dart';
import 'sport_helper.dart';

class MatchLobbyCard extends StatefulWidget {
  final CricketMatch match;
  final VoidCallback onTap;
  const MatchLobbyCard({super.key, required this.match, required this.onTap});

  @override
  State<MatchLobbyCard> createState() => _MatchLobbyCardState();
}

class _MatchLobbyCardState extends State<MatchLobbyCard> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final match = widget.match;
    final isLive = match.isLive;
    final score = match.liveScore;

    String countdown = 'Upcoming';
    if (!isLive && match.startTime.isNotEmpty) {
      final dt = DateTime.tryParse(match.startTime);
      if (dt != null) {
        final diff = dt.difference(DateTime.now());
        if (diff.isNegative) {
          countdown = 'Starting soon';
        } else if (diff.inDays > 0) {
          countdown = '${diff.inDays}d ${diff.inHours % 24}h';
        } else if (diff.inHours > 0) {
          countdown = '${diff.inHours}h ${diff.inMinutes % 60}m';
        } else {
          countdown = '${diff.inMinutes}m';
        }
      }
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isLive ? AppColors.red.withValues(alpha: 0.5) : AppColors.pitchGreen.withValues(alpha: 0.45),
          width: isLive ? 1.5 : 1,
        ),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 10, offset: const Offset(0, 4)),
        ],
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: widget.onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(match.series, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11, fontWeight: FontWeight.w600)),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: isLive ? AppColors.red.withValues(alpha: 0.2) : AppColors.pitchGreen.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: isLive ? AppColors.red.withValues(alpha: 0.5) : AppColors.pitchGreenLight.withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (isLive) ...[
                          Container(width: 5, height: 5, decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle)),
                          const SizedBox(width: 4),
                        ],
                        Text(
                          isLive ? 'LIVE' : match.format.toUpperCase(),
                          style: TextStyle(
                            color: isLive ? AppColors.red : AppColors.pitchGreenLight,
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        _teamFlag(match.teamAFlag),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(match.teamAShort, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                              Text(match.teamA, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    children: [
                      if (isLive) ...[
                        const Text('VS', style: TextStyle(color: AppColors.gold, fontWeight: FontWeight.w900, fontSize: 13)),
                        if (score.hasScore)
                          Text('${score.runs}/${score.wickets}', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold))
                        else
                          const Text('Live Match', style: TextStyle(color: AppColors.textSecondary, fontSize: 10)),
                      ] else ...[
                        Text(countdown, style: const TextStyle(color: AppColors.floodlight, fontSize: 12, fontWeight: FontWeight.bold)),
                        const Text('VS', style: TextStyle(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.bold)),
                      ],
                    ],
                  ),
                  Expanded(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text(match.teamBShort, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                              Text(match.teamB, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _teamFlag(match.teamBFlag),
                      ],
                    ),
                  ),
                ],
              ),
              if (match.markets.isNotEmpty) ...[
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: match.markets.first.options.map((opt) => Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.05),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Text(
                      '${opt.label}: ${opt.odds.toStringAsFixed(2)}x',
                      style: const TextStyle(color: AppColors.gold, fontSize: 10, fontWeight: FontWeight.bold),
                    ),
                  )).toList(),
                ),
              ],
              const Divider(color: Colors.white10, height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        isLive
                            ? const Icon(Icons.live_tv_rounded, size: 14, color: AppColors.red)
                            : Text(SportHelper.getIcon(SportHelper.getCategory(match.format)), style: const TextStyle(fontSize: 13)),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            isLive ? 'Live Center & Real-time Odds' : '${SportHelper.getCategory(match.format)} Match Odds Available',
                            style: const TextStyle(color: Colors.white70, fontSize: 11),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.pitchGreenLight.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.pitchGreenLight.withValues(alpha: 0.5)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          isLive ? 'View Match' : 'Place Bet',
                          style: const TextStyle(color: AppColors.pitchGreenLight, fontWeight: FontWeight.w800, fontSize: 11),
                        ),
                        const SizedBox(width: 3),
                        const Icon(Icons.chevron_right_rounded, size: 14, color: AppColors.pitchGreenLight),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _teamFlag(String? url) {
    return Container(
      width: 40,
      height: 40,
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [Colors.white.withValues(alpha: 0.18), Colors.white.withValues(alpha: 0.04)]),
        border: Border.all(color: Colors.white.withValues(alpha: 0.3), width: 1),
      ),
      child: url == null || url.isEmpty
          ? const Icon(Icons.flag_rounded, color: Colors.white60, size: 16)
          : ClipOval(child: Image.network(url, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const Icon(Icons.flag_rounded, color: Colors.white60, size: 16))),
    );
  }
}
