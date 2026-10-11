import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_models.dart';
import '../widgets/match_lobby_card.dart';
import '../widgets/section_header.dart';
import '../widgets/bet_slip_helper.dart';
import '../widgets/sport_helper.dart';
import 'live_match_center_screen.dart';
import 'sport_matches_screen.dart';

class FixturesTab extends StatelessWidget {
  final List<CricketMatch> matches;
  final Future<void> Function() onRefresh;
  const FixturesTab({super.key, required this.matches, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    // 1. Get unique sports categories dynamically from the matches list
    final categories = matches.map((m) => SportHelper.getCategory(m.format)).toSet().toList();
    categories.sort((a, b) => a == 'Cricket' ? -1 : b == 'Cricket' ? 1 : a.compareTo(b));

    // 2. Filter live matches across all sports for the "Featured Live" section
    final liveMatches = matches.where((m) => m.status == 'live').toList();

    return RefreshIndicator(
      onRefresh: onRefresh,
      color: AppColors.gold,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          // Banner Card
          Container(
            padding: const EdgeInsets.all(18),
            margin: const EdgeInsets.only(bottom: 18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0F172A), Color(0xFF1E293B)],
              ),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: Colors.white.withValues(alpha: 0.1), width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.3),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: RadialGradient(
                      colors: [Colors.white.withValues(alpha: 0.22), Colors.white.withValues(alpha: 0.06)],
                    ),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.35), width: 1.2),
                  ),
                  child: const Center(child: Text('🏆', style: TextStyle(fontSize: 26))),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Sports Betting Hub',
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Colors.white),
                      ),
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.28),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
                        ),
                        child: const Text(
                          'DYNAMIC ODDS · ALL SPORTS INSTANT PAYOUTS',
                          style: TextStyle(
                            fontSize: 9.5,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.6,
                            color: AppColors.gold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Sport Categories Header
          const SectionHeader(
            icon: Icons.sports_football_rounded,
            iconColor: AppColors.gold,
            title: 'Sports Categories',
          ),
          const SizedBox(height: 10),

          // Sports Grid / List
          if (categories.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 40),
              child: Center(
                child: Text(
                  'No sports events available right now.',
                  style: TextStyle(color: AppColors.textSecondary),
                ),
              ),
            )
          else
            ListView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: categories.length,
              itemBuilder: (context, idx) {
                final cat = categories[idx];
                final count = matches.where((m) => SportHelper.getCategory(m.format) == cat).length;
                return Container(
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: SportHelper.getGradient(cat),
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                    ),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: Colors.white.withValues(alpha: 0.1), width: 1),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    leading: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: Text(
                          SportHelper.getIcon(cat),
                          style: const TextStyle(fontSize: 22),
                        ),
                      ),
                    ),
                    title: Text(
                      cat,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    subtitle: Text(
                      '$count matches active',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 12,
                      ),
                    ),
                    trailing: const Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: Colors.white70,
                      size: 16,
                    ),
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => SportMatchesScreen(
                            sportName: cat,
                            matches: matches,
                            onRefresh: onRefresh,
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          const SizedBox(height: 16),

          // Featured Live Section
          if (liveMatches.isNotEmpty) ...[
            const SectionHeader(
              icon: Icons.live_tv_rounded,
              iconColor: AppColors.red,
              title: 'Featured LIVE Matches',
            ),
            const SizedBox(height: 8),
            ...liveMatches.take(5).map((m) => MatchLobbyCard(
                  match: m,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => LiveMatchCenterScreen(match: m)),
                  ),
                )),
          ],
        ],
      ),
    );
  }
}
