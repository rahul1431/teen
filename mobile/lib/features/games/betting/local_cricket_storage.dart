import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class LocalCricketStorage {
  static const String _keyMatches = 'cached_cricket_matches';
  static const String _keyPlayersPrefix = 'cached_cricket_players_';
  static const String _keyLeaguesPrefix = 'cached_cricket_leagues_';

  // --- Matches ---
  static Future<void> saveMatches(List<dynamic> matches) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyMatches, jsonEncode(matches));
  }

  static Future<List<dynamic>> getMatches() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString(_keyMatches);
    if (data == null) {
      // Return pre-seeded mock matches
      return _defaultMatches;
    }
    try {
      return jsonDecode(data) as List<dynamic>;
    } catch (_) {
      return _defaultMatches;
    }
  }

  // --- Players ---
  static Future<void> savePlayers(String matchId, List<dynamic> players) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_keyPlayersPrefix$matchId', jsonEncode(players));
  }

  static Future<List<dynamic>> getPlayers(String matchId) async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString('$_keyPlayersPrefix$matchId');
    if (data == null) {
      if (matchId == '55c8c7db-115f-4d37-88f5-46ff85aa0001') {
        return _defaultPlayers;
      }
      return [];
    }
    try {
      return jsonDecode(data) as List<dynamic>;
    } catch (_) {
      return matchId == '55c8c7db-115f-4d37-88f5-46ff85aa0001' ? _defaultPlayers : [];
    }
  }

  // --- Leagues ---
  static Future<void> saveLeagues(String matchId, List<dynamic> leagues) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('$_keyLeaguesPrefix$matchId', jsonEncode(leagues));
  }

  static Future<List<dynamic>> getLeagues(String matchId) async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString('$_keyLeaguesPrefix$matchId');
    if (data == null) {
      if (matchId == '55c8c7db-115f-4d37-88f5-46ff85aa0001') {
        return _defaultLeagues;
      }
      return [];
    }
    try {
      return jsonDecode(data) as List<dynamic>;
    } catch (_) {
      return matchId == '55c8c7db-115f-4d37-88f5-46ff85aa0001' ? _defaultLeagues : [];
    }
  }

  // =============================================================================
  // PRE-SEEDED DATASETS (For Offline/Fallback Play)
  // =============================================================================

  static final List<dynamic> _defaultMatches = [
    {
      'id': '55c8c7db-115f-4d37-88f5-46ff85aa0001',
      'series': 'ICC T20 World Cup',
      'format': 't20',
      'team_a': 'India',
      'team_b': 'Australia',
      'team_a_short': 'IND',
      'team_b_short': 'AUS',
      'status': 'upcoming',
      'start_time': '2026-07-10T18:30:00Z',
      'team_a_flag': 'https://flagcdn.com/w80/in.png',
      'team_b_flag': 'https://flagcdn.com/w80/au.png',
      'markets': [],
      'live_score': {},
    }
  ];

  static final List<dynamic> _defaultLeagues = [
    {
      'id': '66c8c7db-115f-4d37-88f5-46ff85aa0001',
      'match_id': '55c8c7db-115f-4d37-88f5-46ff85aa0001',
      'name': 'Mega Contest 🏆',
      'entry_fee': 49.00,
      'prize_pool': 10000.00,
      'max_entries': 250,
      'current_entries': 34,
      'status': 'open',
      'joined_entry_id': null,
      'prize_distribution': [
        {'rank_start': 1, 'rank_end': 1, 'payout': 5000},
        {'rank_start': 2, 'rank_end': 2, 'payout': 2000},
        {'rank_start': 3, 'rank_end': 5, 'payout': 1000}
      ]
    },
    {
      'id': '66c8c7db-115f-4d37-88f5-46ff85aa0002',
      'match_id': '55c8c7db-115f-4d37-88f5-46ff85aa0001',
      'name': 'Head-to-Head 🤝',
      'entry_fee': 250.00,
      'prize_pool': 450.00,
      'max_entries': 2,
      'current_entries': 1,
      'status': 'open',
      'joined_entry_id': null,
      'prize_distribution': [
        {'rank_start': 1, 'rank_end': 1, 'payout': 450}
      ]
    },
    {
      'id': '66c8c7db-115f-4d37-88f5-46ff85aa0003',
      'match_id': '55c8c7db-115f-4d37-88f5-46ff85aa0001',
      'name': 'Practice Contest 🆓',
      'entry_fee': 0.00,
      'prize_pool': 0.00,
      'max_entries': 100,
      'current_entries': 12,
      'status': 'open',
      'joined_entry_id': null,
      'prize_distribution': []
    }
  ];

  static final List<dynamic> _defaultPlayers = [
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0001', 'name': 'Virat Kohli', 'role': 'batsman', 'credits': 10.0, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Virat' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0002', 'name': 'Rohit Sharma', 'role': 'batsman', 'credits': 9.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rohit' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0003', 'name': 'Yashasvi Jaiswal', 'role': 'batsman', 'credits': 8.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Yashasvi' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0004', 'name': 'KL Rahul', 'role': 'wicket_keeper', 'credits': 9.0, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=KL_Rahul' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0005', 'name': 'Rishabh Pant', 'role': 'wicket_keeper', 'credits': 9.0, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Rishabh' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0006', 'name': 'Hardik Pandya', 'role': 'all_rounder', 'credits': 9.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Hardik' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0007', 'name': 'Ravindra Jadeja', 'role': 'all_rounder', 'credits': 9.0, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Ravindra' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0008', 'name': 'Axar Patel', 'role': 'all_rounder', 'credits': 8.0, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Axar' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0009', 'name': 'Jasprit Bumrah', 'role': 'bowler', 'credits': 9.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bumrah' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0010', 'name': 'Mohammed Shami', 'role': 'bowler', 'credits': 8.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Shami' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0011', 'name': 'Kuldeep Yadav', 'role': 'bowler', 'credits': 8.5, 'team_name': 'India', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Kuldeep' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0012', 'name': 'David Warner', 'role': 'batsman', 'credits': 9.0, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Warner' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0013', 'name': 'Travis Head', 'role': 'batsman', 'credits': 9.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Travis' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0014', 'name': 'Glenn Maxwell', 'role': 'all_rounder', 'credits': 9.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Maxwell' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0015', 'name': 'Mitchell Marsh', 'role': 'all_rounder', 'credits': 9.0, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Marsh' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0016', 'name': 'Marcus Stoinis', 'role': 'all_rounder', 'credits': 8.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Stoinis' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0017', 'name': 'Matthew Wade', 'role': 'wicket_keeper', 'credits': 8.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Wade' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0018', 'name': 'Alex Carey', 'role': 'wicket_keeper', 'credits': 8.0, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Carey' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0019', 'name': 'Pat Cummins', 'role': 'bowler', 'credits': 9.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Cummins' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0020', 'name': 'Mitchell Starc', 'role': 'bowler', 'credits': 9.0, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Starc' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0021', 'name': 'Josh Hazlewood', 'role': 'bowler', 'credits': 8.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Hazlewood' },
    { 'id': '44c8c7db-115f-4d37-88f5-46ff85aa0022', 'name': 'Adam Zampa', 'role': 'bowler', 'credits': 8.5, 'team_name': 'Australia', 'avatar_url': 'https://api.dicebear.com/7.x/adventurer/svg?seed=Adam' }
  ];
}
