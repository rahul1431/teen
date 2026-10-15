import 'package:flutter/material.dart';
import '../data/cricket_models.dart';

class SportDef {
  final String name;
  final String icon;
  final String subtitle;
  final List<Color> gradient;
  final Color accent;
  final String formatPrefix;

  const SportDef({
    required this.name,
    required this.icon,
    required this.subtitle,
    required this.gradient,
    required this.accent,
    required this.formatPrefix,
  });
}

class SportHelper {
  static const List<SportDef> popularSports = [
    SportDef(
      name: 'Cricket',
      icon: '🏏',
      subtitle: 'IPL, T20 World Cup, In-Play Overs',
      gradient: [Color(0xFF0F3025), Color(0xFF1E5631), Color(0xFF143B22)],
      accent: Color(0xFF86EFAC),
      formatPrefix: 'cricket',
    ),
    SportDef(
      name: 'Football',
      icon: '⚽',
      subtitle: 'Premier League, Champions League, ISL',
      gradient: [Color(0xFF0F172A), Color(0xFF1E3A8A), Color(0xFF172554)],
      accent: Color(0xFF60A5FA),
      formatPrefix: 'soccer',
    ),
    SportDef(
      name: 'Tennis',
      icon: '🎾',
      subtitle: 'Grand Slams, Wimbledon, ATP Tour',
      gradient: [Color(0xFF1E3A5F), Color(0xFF065F46), Color(0xFF047857)],
      accent: Color(0xFF34D399),
      formatPrefix: 'tennis',
    ),
    SportDef(
      name: 'Basketball',
      icon: '🏀',
      subtitle: 'NBA Championship, EuroLeague, FIBA',
      gradient: [Color(0xFF451A03), Color(0xFF9A3412), Color(0xFFC2410C)],
      accent: Color(0xFFFDBA74),
      formatPrefix: 'basketball',
    ),
    SportDef(
      name: 'Combat Sports',
      icon: '🥊',
      subtitle: 'UFC Title Fights & World Boxing',
      gradient: [Color(0xFF450A0A), Color(0xFF991B1B), Color(0xFFB91C1C)],
      accent: Color(0xFFFCA5A5),
      formatPrefix: 'mma',
    ),
    SportDef(
      name: 'American Football',
      icon: '🏈',
      subtitle: 'NFL Championship & Super Bowl',
      gradient: [Color(0xFF3B0764), Color(0xFF6B21A8), Color(0xFF581C87)],
      accent: Color(0xFFD8B4FE),
      formatPrefix: 'americanfootball',
    ),
    SportDef(
      name: 'Baseball',
      icon: '⚾',
      subtitle: 'MLB World Series & NPB',
      gradient: [Color(0xFF134E4A), Color(0xFF0F766E), Color(0xFF115E59)],
      accent: Color(0xFF5EEAD4),
      formatPrefix: 'baseball',
    ),
    SportDef(
      name: 'Ice Hockey',
      icon: '🏒',
      subtitle: 'NHL Stanley Cup & KHL',
      gradient: [Color(0xFF172554), Color(0xFF2563EB), Color(0xFF1D4ED8)],
      accent: Color(0xFF93C5FD),
      formatPrefix: 'icehockey',
    ),
    SportDef(
      name: 'Formula 1',
      icon: '🏎️',
      subtitle: 'Grand Prix & Motorsports',
      gradient: [Color(0xFF3F0712), Color(0xFFBE123C), Color(0xFF9F1239)],
      accent: Color(0xFFFDA4AF),
      formatPrefix: 'f1',
    ),
    SportDef(
      name: 'Table Tennis',
      icon: '🏓',
      subtitle: 'Pro League & WTT Contender',
      gradient: [Color(0xFF1E293B), Color(0xFF334155), Color(0xFF0F172A)],
      accent: Color(0xFF94A3B8),
      formatPrefix: 'tabletennis',
    ),
  ];

  static String getCategory(String format) {
    final f = format.toLowerCase().trim();
    if (f.contains('cricket') || f == 't20' || f == 'odi' || f == 'test' || f == 'ipl' || f == 't10') return 'Cricket';
    if (f.contains('soccer') || f.contains('football') || f.contains('epl') || f.contains('la_liga') || f.contains('isl') || f.contains('uefa') || f.contains('fifa')) return 'Football';
    if (f.contains('tennis') || f.contains('atp') || f.contains('wta') || f.contains('wimbledon')) return 'Tennis';
    if (f.contains('basketball') || f.contains('nba') || f.contains('euroleague')) return 'Basketball';
    if (f.contains('americanfootball') || f.contains('nfl')) return 'American Football';
    if (f.contains('baseball') || f.contains('mlb')) return 'Baseball';
    if (f.contains('icehockey') || f.contains('nhl')) return 'Ice Hockey';
    if (f.contains('mma') || f.contains('ufc') || f.contains('boxing') || f.contains('combat')) return 'Combat Sports';
    if (f.contains('formula') || f.contains('f1') || f.contains('motorsport')) return 'Formula 1';
    if (f.contains('tabletennis') || f.contains('table_tennis')) return 'Table Tennis';
    if (f.contains('esports') || f.contains('dota') || f.contains('csgo')) return 'Esports';
    if (f.contains('rugby') || f.contains('aussierules')) return 'Rugby';
    return 'Other Sports';
  }

  static String getIcon(String category) {
    switch (category) {
      case 'Cricket': return '🏏';
      case 'Football':
      case 'Soccer': return '⚽';
      case 'Tennis': return '🎾';
      case 'Basketball': return '🏀';
      case 'Combat Sports': return '🥊';
      case 'American Football': return '🏈';
      case 'Baseball': return '⚾';
      case 'Ice Hockey': return '🏒';
      case 'Formula 1': return '🏎️';
      case 'Table Tennis': return '🏓';
      case 'Esports': return '🎮';
      case 'Rugby': return '🏉';
      default: return '🏆';
    }
  }

  static List<Color> getGradient(String category) {
    switch (category) {
      case 'Cricket': return [const Color(0xFF0F3025), const Color(0xFF1E5631), const Color(0xFF143B22)];
      case 'Football':
      case 'Soccer': return [const Color(0xFF0F172A), const Color(0xFF1E3A8A), const Color(0xFF172554)];
      case 'Tennis': return [const Color(0xFF1E3A5F), const Color(0xFF065F46), const Color(0xFF047857)];
      case 'Basketball': return [const Color(0xFF451A03), const Color(0xFF9A3412), const Color(0xFFC2410C)];
      case 'Combat Sports': return [const Color(0xFF450A0A), const Color(0xFF991B1B), const Color(0xFFB91C1C)];
      case 'American Football': return [const Color(0xFF3B0764), const Color(0xFF6B21A8), const Color(0xFF581C87)];
      case 'Baseball': return [const Color(0xFF134E4A), const Color(0xFF0F766E), const Color(0xFF115E59)];
      case 'Ice Hockey': return [const Color(0xFF172554), const Color(0xFF2563EB), const Color(0xFF1D4ED8)];
      case 'Formula 1': return [const Color(0xFF3F0712), const Color(0xFFBE123C), const Color(0xFF9F1239)];
      case 'Table Tennis': return [const Color(0xFF1E293B), const Color(0xFF334155), const Color(0xFF0F172A)];
      default: return [const Color(0xFF1F2937), const Color(0xFF374151), const Color(0xFF111827)];
    }
  }

  static Color getAccentColor(String category) {
    switch (category) {
      case 'Cricket': return const Color(0xFF86EFAC);
      case 'Football':
      case 'Soccer': return const Color(0xFF60A5FA);
      case 'Tennis': return const Color(0xFF34D399);
      case 'Basketball': return const Color(0xFFFDBA74);
      case 'Combat Sports': return const Color(0xFFFCA5A5);
      case 'American Football': return const Color(0xFFD8B4FE);
      case 'Baseball': return const Color(0xFF5EEAD4);
      case 'Ice Hockey': return const Color(0xFF93C5FD);
      case 'Formula 1': return const Color(0xFFFDA4AF);
      default: return const Color(0xFFFCD34D);
    }
  }

  /// Generates instant demonstration / preview matches for a sport if live feeds are currently quiet
  static List<CricketMatch> getFallbackMatches(String sportName) {
    final now = DateTime.now();
    switch (sportName) {
      case 'Football':
        return [
          CricketMatch(
            id: 'fb_demo_1',
            series: 'English Premier League',
            format: 'soccer_epl',
            teamA: 'Arsenal',
            teamB: 'Chelsea',
            teamAShort: 'ARS',
            teamBShort: 'CHE',
            teamAFlag: 'https://flagcdn.com/w80/gb-eng.png',
            teamBFlag: 'https://flagcdn.com/w80/gb-eng.png',
            status: 'upcoming',
            startTime: now.add(const Duration(hours: 3)).toIso8601String(),
            liveScore: const LiveScore(),
            markets: [
              const OddsMarket(
                id: 'm_fb_1',
                matchId: 'fb_demo_1',
                marketType: 'match_winner',
                label: 'Full Time Result (1X2)',
                status: 'open',
                options: [
                  OddsMarketOption(key: 'team_a', label: 'Arsenal', odds: 1.95),
                  OddsMarketOption(key: 'draw', label: 'Draw', odds: 3.40),
                  OddsMarketOption(key: 'team_b', label: 'Chelsea', odds: 3.75),
                ],
              )
            ],
          ),
          CricketMatch(
            id: 'fb_demo_2',
            series: 'UEFA Champions League',
            format: 'soccer_uefa',
            teamA: 'Real Madrid',
            teamB: 'Bayern Munich',
            teamAShort: 'RMA',
            teamBShort: 'BAY',
            teamAFlag: 'https://flagcdn.com/w80/es.png',
            teamBFlag: 'https://flagcdn.com/w80/de.png',
            status: 'live',
            startTime: now.subtract(const Duration(minutes: 25)).toIso8601String(),
            liveScore: const LiveScore(runs: 2, wickets: 1, overs: "68'", description: "Real Madrid 2 - 1 Bayern (68')"),
            markets: [
              const OddsMarket(
                id: 'm_fb_2',
                matchId: 'fb_demo_2',
                marketType: 'match_winner',
                label: 'Match Winner',
                status: 'open',
                options: [
                  OddsMarketOption(key: 'team_a', label: 'Real Madrid', odds: 1.70),
                  OddsMarketOption(key: 'draw', label: 'Draw', odds: 3.80),
                  OddsMarketOption(key: 'team_b', label: 'Bayern Munich', odds: 4.50),
                ],
              )
            ],
          ),
        ];

      case 'Tennis':
        return [
          CricketMatch(
            id: 'tn_demo_1',
            series: 'Wimbledon Championships',
            format: 'tennis_atp',
            teamA: 'Carlos Alcaraz',
            teamB: 'Jannik Sinner',
            teamAShort: 'ALC',
            teamBShort: 'SIN',
            teamAFlag: 'https://flagcdn.com/w80/es.png',
            teamBFlag: 'https://flagcdn.com/w80/it.png',
            status: 'upcoming',
            startTime: now.add(const Duration(hours: 4)).toIso8601String(),
            liveScore: const LiveScore(),
            markets: [
              const OddsMarket(
                id: 'm_tn_1',
                matchId: 'tn_demo_1',
                marketType: 'match_winner',
                label: 'Match Winner',
                status: 'open',
                options: [
                  OddsMarketOption(key: 'team_a', label: 'Carlos Alcaraz', odds: 1.92),
                  OddsMarketOption(key: 'team_b', label: 'Jannik Sinner', odds: 1.88),
                ],
              )
            ],
          ),
        ];

      case 'Basketball':
        return [
          CricketMatch(
            id: 'bb_demo_1',
            series: 'NBA Championship',
            format: 'basketball_nba',
            teamA: 'Los Angeles Lakers',
            teamB: 'Boston Celtics',
            teamAShort: 'LAL',
            teamBShort: 'BOS',
            teamAFlag: 'https://flagcdn.com/w80/us.png',
            teamBFlag: 'https://flagcdn.com/w80/us.png',
            status: 'upcoming',
            startTime: now.add(const Duration(hours: 5)).toIso8601String(),
            liveScore: const LiveScore(),
            markets: [
              const OddsMarket(
                id: 'm_bb_1',
                matchId: 'bb_demo_1',
                marketType: 'match_winner',
                label: 'Moneyline Winner',
                status: 'open',
                options: [
                  OddsMarketOption(key: 'team_a', label: 'LA Lakers', odds: 2.15),
                  OddsMarketOption(key: 'team_b', label: 'Boston Celtics', odds: 1.72),
                ],
              )
            ],
          ),
        ];

      case 'Combat Sports':
        return [
          CricketMatch(
            id: 'cb_demo_1',
            series: 'UFC 315 Main Event',
            format: 'mma_ufc',
            teamA: 'Islam Makhachev',
            teamB: 'Arman Tsarukyan',
            teamAShort: 'MAK',
            teamBShort: 'TSA',
            teamAFlag: 'https://flagcdn.com/w80/ru.png',
            teamBFlag: 'https://flagcdn.com/w80/am.png',
            status: 'upcoming',
            startTime: now.add(const Duration(hours: 8)).toIso8601String(),
            liveScore: const LiveScore(),
            markets: [
              const OddsMarket(
                id: 'm_cb_1',
                matchId: 'cb_demo_1',
                marketType: 'match_winner',
                label: 'Fight Winner',
                status: 'open',
                options: [
                  OddsMarketOption(key: 'team_a', label: 'Islam Makhachev', odds: 1.45),
                  OddsMarketOption(key: 'team_b', label: 'Arman Tsarukyan', odds: 2.80),
                ],
              )
            ],
          ),
        ];

      default:
        return [];
    }
  }
}
