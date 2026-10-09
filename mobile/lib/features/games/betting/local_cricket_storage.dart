import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class LocalCricketStorage {
  static const String _keyMatches = 'cached_cricket_matches';

  // --- Matches ---
  static Future<void> saveMatches(List<dynamic> matches) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyMatches, jsonEncode(matches));
  }

  static Future<List<dynamic>> getMatches() async {
    final prefs = await SharedPreferences.getInstance();
    final data = prefs.getString(_keyMatches);
    if (data == null) {
      return _defaultMatches;
    }
    try {
      return jsonDecode(data) as List<dynamic>;
    } catch (_) {
      return _defaultMatches;
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
}
