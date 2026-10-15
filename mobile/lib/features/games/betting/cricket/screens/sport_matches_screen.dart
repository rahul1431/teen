import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_models.dart';
import '../widgets/match_lobby_card.dart';
import '../widgets/section_header.dart';
import '../widgets/bet_slip_helper.dart';
import '../widgets/sport_helper.dart';
import 'live_match_center_screen.dart';
import 'match_details_screen.dart';

class SportMatchesScreen extends StatelessWidget {
  final String sportName;
  final List<CricketMatch> matches;
  final Future<void> Function() onRefresh;

  const SportMatchesScreen({
    super.key,
    required this.sportName,
    required this.matches,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    List<CricketMatch> sportMatches = matches.where((m) => SportHelper.getCategory(m.format) == sportName).toList();
    if (sportMatches.isEmpty) {
      sportMatches = SportHelper.getFallbackMatches(sportName);
    }
    final live = sportMatches.where((m) => m.status == 'live').toList();
    final upcoming = sportMatches.where((m) => m.status == 'upcoming').toList();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Row(
          children: [
            Text(SportHelper.getIcon(sportName), style: const TextStyle(fontSize: 20)),
            const SizedBox(width: 8),
            Text('$sportName Betting', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: onRefresh,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: onRefresh,
        color: AppColors.gold,
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: SportHelper.getGradient(sportName),
                ),
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: Colors.white.withValues(alpha: 0.15), width: 1.5),
              ),
              child: Row(
                children: [
                  Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: Colors.white.withValues(alpha: 0.1),
                    ),
                    child: Center(
                      child: Text(
                        SportHelper.getIcon(sportName),
                        style: const TextStyle(fontSize: 24),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '$sportName Fixtures',
                          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${sportMatches.length} Matches Ingested · Automatic Payouts',
                          style: const TextStyle(fontSize: 11, color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (live.isNotEmpty) ...[
              const SectionHeader(icon: Icons.live_tv_rounded, iconColor: AppColors.red, title: 'LIVE Matches'),
              const SizedBox(height: 8),
              ...live.map((m) => MatchLobbyCard(
                    match: m,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => MatchDetailsScreen(match: m)),
                    ),
                  )),
              const SizedBox(height: 16),
            ],
            const SectionHeader(icon: Icons.upcoming, iconColor: AppColors.pitchGreenLight, title: 'Upcoming Matches'),
            const SizedBox(height: 8),
            if (upcoming.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                    'No upcoming matches for this sport',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                ),
              )
            else
              ...upcoming.map((m) => MatchLobbyCard(
                    match: m,
                    onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => MatchDetailsScreen(match: m)),
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}
