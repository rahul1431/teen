import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../local_cricket_storage.dart';
import 'cricket_models.dart';

class CricketApiException implements Exception {
  final String message;
  const CricketApiException(this.message);
  @override
  String toString() => message;
}

/// All network access for the cricket feature. Screens/cubits never touch
/// dio or raw JSON directly — everything in and out of here is a typed
/// model from cricket_models.dart.
class CricketApi {
  Dio get _dio => ApiClient().dio;

  Future<List<CricketMatch>> fetchMatches() async {
    try {
      final res = await _dio.get('/api/betting/cricket/matches');
      final matches = (res.data['matches'] as List).cast<Map<String, dynamic>>();
      await LocalCricketStorage.saveMatches(matches);
      return matches.map(CricketMatch.fromJson).toList();
    } catch (_) {
      final cached = await LocalCricketStorage.getMatches();
      return cached.cast<Map<String, dynamic>>().map(CricketMatch.fromJson).toList();
    }
  }

  Future<void> placeOddsBet({
    required String marketId,
    required String optionKey,
    required double amount,
  }) async {
    try {
      await _dio.post('/api/betting/cricket/odds/bet', data: {
        'market_id': marketId,
        'option_key': optionKey,
        'amount': amount,
      });
    } on DioException catch (e) {
      throw CricketApiException(e.response?.data?['error']?.toString() ?? 'Failed to place bet');
    }
  }

  Future<List<OddsBetRecord>> fetchOddsBetHistory() async {
    final res = await _dio.get('/api/betting/cricket/odds/my-bets');
    return (res.data['bets'] as List? ?? []).cast<Map<String, dynamic>>().map(OddsBetRecord.fromJson).toList();
  }

  Future<List<SessionBetRecord>> fetchSessionBetHistory() async {
    final res = await _dio.get('/api/betting/cricket/session/my-bets');
    return (res.data['bets'] as List? ?? []).cast<Map<String, dynamic>>().map(SessionBetRecord.fromJson).toList();
  }

  Future<LiveMatchData> fetchLiveMatch(CricketMatch fallback) async {
    final res = await _dio.get('/api/betting/cricket/matches/${fallback.id}/live');
    return LiveMatchData.fromJson(res.data as Map<String, dynamic>, fallback);
  }

  Future<void> placeSessionBet({required String sessionId, required String selection, required double amount}) async {
    await _dio.post('/api/betting/cricket/session/bet', data: {
      'session_id': sessionId,
      'selection': selection,
      'amount': amount,
    });
  }
}
