import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_models.dart';
import '../widgets/match_lobby_card.dart';
import '../widgets/section_header.dart';
import '../widgets/bet_slip_helper.dart';
import '../widgets/sport_helper.dart';
import 'live_match_center_screen.dart';
import 'sport_matches_screen.dart';
import 'match_details_screen.dart';

class FixturesTab extends StatefulWidget {
  final List<CricketMatch> matches;
  final Future<void> Function() onRefresh;

  const FixturesTab({
    super.key,
    required this.matches,
    required this.onRefresh,
  });

  @override
  State<FixturesTab> createState() => _FixturesTabState();
}

class _FixturesTabState extends State<FixturesTab> {
  String _selectedSport = 'All';

  @override
  Widget build(BuildContext context) {
    // 1. Gather all active sports categories
    final availableCategories = widget.matches.map((m) => SportHelper.getCategory(m.format)).toSet().toList();
    availableCategories.sort((a, b) => a == 'Cricket' ? -1 : b == 'Cricket' ? 1 : a.compareTo(b));

    // 2. Filter matches by selected sport, fallback to mock fixtures if empty for that specific sport
    List<CricketMatch> effectiveMatches = widget.matches;
    if (_selectedSport != 'All') {
      effectiveMatches = widget.matches.where((m) => SportHelper.getCategory(m.format) == _selectedSport).toList();
      if (effectiveMatches.isEmpty) {
        effectiveMatches = SportHelper.getFallbackMatches(_selectedSport);
      }
    }

    final liveMatches = effectiveMatches.where((m) => m.status == 'live').toList();
    final upcomingMatches = effectiveMatches.where((m) => m.status == 'upcoming').toList();

    return RefreshIndicator(
      onRefresh: widget.onRefresh,
      color: AppColors.gold,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          // ── Hero Sports Hub Banner ──
          Container(
            padding: const EdgeInsets.all(18),
            margin: const EdgeInsets.only(bottom: 16),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFF0F172A), Color(0xFF1E293B), Color(0xFF0F2027)],
              ),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: Colors.white.withValues(alpha: 0.12), width: 1.5),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.35),
                  blurRadius: 12,
                  offset: const Offset(0, 5),
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
                      colors: [AppColors.gold.withValues(alpha: 0.3), Colors.transparent],
                    ),
                    border: Border.all(color: AppColors.gold.withValues(alpha: 0.5), width: 1.5),
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
                        style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900, color: Colors.white),
                      ),
                      const SizedBox(height: 5),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.3),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
                        ),
                        child: const Text(
                          'CRICKET · FOOTBALL · TENNIS · BASKETBALL & MORE',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                            letterSpacing: 0.5,
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

          // ── Featured Sports Games Section ──
          const SectionHeader(
            icon: Icons.sports_rounded,
            iconColor: AppColors.gold,
            title: 'Sports Games',
          ),
          const SizedBox(height: 10),

          // Horizontal scroll of sports cards
          SizedBox(
            height: 110,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: SportHelper.popularSports.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (context, idx) {
                final sport = SportHelper.popularSports[idx];
                final count = widget.matches.where((m) => SportHelper.getCategory(m.format) == sport.name).length;
                final isSelected = _selectedSport == sport.name;

                return GestureDetector(
                  onTap: () {
                    setState(() {
                      _selectedSport = isSelected ? 'All' : sport.name;
                    });
                  },
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    width: 135,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: sport.gradient,
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: isSelected ? AppColors.gold : Colors.white.withValues(alpha: 0.15),
                        width: isSelected ? 2.0 : 1.0,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: sport.gradient.first.withValues(alpha: 0.4),
                          blurRadius: isSelected ? 12 : 6,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(sport.icon, style: const TextStyle(fontSize: 24)),
                            if (count > 0)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.red.withValues(alpha: 0.8),
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  '$count',
                                  style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                                ),
                              ),
                          ],
                        ),
                        const Spacer(),
                        Text(
                          sport.name,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          count > 0 ? '$count matches' : 'Explore',
                          style: TextStyle(
                            color: sport.accent,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 18),

          // ── Sport Filter Pills ──
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _filterPill('All', '🏆'),
                const SizedBox(width: 8),
                ...SportHelper.popularSports.map((s) {
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: _filterPill(s.name, s.icon),
                  );
                }),
              ],
            ),
          ),
          const SizedBox(height: 18),

          // ── LIVE In-Play Section ──
          if (liveMatches.isNotEmpty) ...[
            SectionHeader(
              icon: Icons.live_tv_rounded,
              iconColor: AppColors.red,
              title: _selectedSport == 'All' ? 'LIVE Matches (${liveMatches.length})' : 'LIVE $_selectedSport (${liveMatches.length})',
            ),
            const SizedBox(height: 8),
            ...liveMatches.map((m) => MatchLobbyCard(
                  match: m,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => MatchDetailsScreen(match: m)),
                  ),
                )),
            const SizedBox(height: 16),
          ],

          // ── Upcoming Matches Section ──
          SectionHeader(
            icon: Icons.schedule_rounded,
            iconColor: AppColors.pitchGreenLight,
            title: _selectedSport == 'All' ? 'Upcoming Fixtures' : 'Upcoming $_selectedSport Fixtures',
          ),
          const SizedBox(height: 8),

          if (upcomingMatches.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 16),
              margin: const EdgeInsets.only(bottom: 20),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white10),
              ),
              child: Column(
                children: [
                  Text(
                    SportHelper.getIcon(_selectedSport),
                    style: const TextStyle(fontSize: 36),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'No $_selectedSport fixtures currently live',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'Check back soon or explore other sports games above.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          else
            ...upcomingMatches.map((m) => MatchLobbyCard(
                  match: m,
                  onTap: () => Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => MatchDetailsScreen(match: m)),
                  ),
                )),
        ],
      ),
    );
  }

  Widget _filterPill(String title, String icon) {
    final isSelected = _selectedSport == title;
    return GestureDetector(
      onTap: () => setState(() => _selectedSport = title),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.gold.withValues(alpha: 0.2) : Colors.white.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: isSelected ? AppColors.gold : Colors.white12,
            width: isSelected ? 1.5 : 1.0,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(icon, style: const TextStyle(fontSize: 13)),
            const SizedBox(width: 6),
            Text(
              title,
              style: TextStyle(
                color: isSelected ? AppColors.gold : Colors.white70,
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.w800 : FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
