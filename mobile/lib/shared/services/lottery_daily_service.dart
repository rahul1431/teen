import 'package:dio/dio.dart';

class LotteryDailyService {
  final Dio _dio;

  LotteryDailyService(this._dio);

  Future<List<dynamic>> getTiers() async {
    final response = await _dio.get('/api/betting/lottery/daily/tiers');
    return response.data['tiers'] ?? [];
  }

  Future<dynamic> getDraw(String drawId) async {
    final response = await _dio.get('/api/betting/lottery/daily/draws/$drawId');
    return response.data;
  }

  Future<List<dynamic>> getDraws() async {
    final response = await _dio.get('/api/betting/lottery/daily/draws');
    return response.data['draws'] ?? [];
  }

  Future<dynamic> buyTicket(String drawId, String ticketNumber) async {
    final response = await _dio.post(
      '/api/betting/lottery/daily/buy',
      data: {'draw_id': drawId, 'ticket_number': ticketNumber},
    );
    return response.data;
  }

  Future<List<dynamic>> getMyTickets() async {
    final response = await _dio.get('/api/betting/lottery/daily/my-tickets');
    return response.data['tickets'] ?? [];
  }

  Future<List<dynamic>> getHistory() async {
    final response = await _dio.get('/api/betting/lottery/daily/history');
    return response.data['draws'] ?? [];
  }
}
