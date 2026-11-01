import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../../core/constants/app_config.dart';
import '../models/agent_models.dart';

class AgentApiService {
  static final AgentApiService _instance = AgentApiService._internal();
  factory AgentApiService() => _instance;

  late final Dio _dio;
  static const _storage = FlutterSecureStorage();
  static const _tokenKey = 'agent_portal_jwt_token';
  static const _savedUsernameKey = 'agent_saved_username';
  static const _biometricEnabledKey = 'agent_biometric_enabled';

  AgentApiService._internal() {
    _dio = Dio(BaseOptions(
      baseUrl: '${AppConfig.apiBaseUrl.trim()}/api/admin/agent-portal',
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _storage.read(key: _tokenKey);
        if (token != null && token.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (err, handler) {
        return handler.next(err);
      },
    ));
  }

  // Token storage
  Future<void> saveToken(String token) => _storage.write(key: _tokenKey, value: token);
  Future<String?> getToken() => _storage.read(key: _tokenKey);
  Future<void> clearToken() => _storage.delete(key: _tokenKey);

  // Biometric preferences
  Future<void> setBiometricEnabled(bool enabled) =>
      _storage.write(key: _biometricEnabledKey, value: enabled.toString());
  Future<bool> isBiometricEnabled() async =>
      (await _storage.read(key: _biometricEnabledKey)) == 'true';

  Future<void> saveUsername(String username) =>
      _storage.write(key: _savedUsernameKey, value: username);
  Future<String?> getSavedUsername() => _storage.read(key: _savedUsernameKey);

  // 1. Auth: Login
  Future<Map<String, dynamic>> login(String username, String password) async {
    try {
      final res = await _dio.post('/auth/login', data: {
        'username': username.trim(),
        'password': password,
      });
      final token = res.data['token'] as String;
      await saveToken(token);
      await saveUsername(username);
      return res.data;
    } on DioException catch (e) {
      final msg = e.response?.data?['error'] ?? 'Login failed. Please check credentials.';
      throw Exception(msg);
    }
  }

  // 2. Profile & Dashboard
  Future<AgentProfile> getProfile() async {
    try {
      final res = await _dio.get('/me');
      return AgentProfile.fromJson(res.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load profile');
    }
  }

  // 3. Live Commission
  Future<LiveCommissionSummary> getLiveCommission() async {
    try {
      final res = await _dio.get('/commission/live');
      return LiveCommissionSummary.fromJson(res.data);
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to fetch live commission');
    }
  }

  // 4. Players
  Future<List<AgentPlayerItem>> getPlayers({int page = 1, int limit = 50}) async {
    try {
      final res = await _dio.get('/players', queryParameters: {'page': page, 'limit': limit});
      final list = (res.data['players'] as List<dynamic>? ?? [])
          .map((p) => AgentPlayerItem.fromJson(p as Map<String, dynamic>))
          .toList();
      return list;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load players');
    }
  }

  // 5. Player Search (for chip topup)
  Future<List<Map<String, dynamic>>> searchPlayer(String query) async {
    try {
      final res = await _dio.get('/player-search', queryParameters: {'query': query});
      return (res.data as List<dynamic>? ?? []).cast<Map<String, dynamic>>();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Player search failed');
    }
  }

  // 6. Direct Player Top-Up ("Chip Transfer")
  Future<Map<String, dynamic>> topUpPlayer({
    required String playerIdentifier,
    required double amount,
    String? notes,
  }) async {
    try {
      final res = await _dio.post('/player-topup', data: {
        'player_identifier': playerIdentifier.trim(),
        'amount': amount,
        if (notes != null) 'notes': notes,
      });
      return res.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Chip transfer failed');
    }
  }

  // 7. Sub-Agents
  Future<Map<String, dynamic>> createSubAgent({
    required String username,
    required String password,
    required String displayName,
    String? phone,
    required double commissionRate,
  }) async {
    try {
      final res = await _dio.post('/sub-agents', data: {
        'username': username.trim(),
        'password': password,
        'display_name': displayName.trim(),
        if (phone != null && phone.isNotEmpty) 'phone': phone.trim(),
        'commission_rate': commissionRate,
      });
      return res.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to create sub-agent');
    }
  }

  // 8. Payouts
  Future<List<AgentPayoutItem>> getPayouts() async {
    try {
      final res = await _dio.get('/payouts');
      return (res.data as List<dynamic>? ?? [])
          .map((p) => AgentPayoutItem.fromJson(p as Map<String, dynamic>))
          .toList();
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to load payouts');
    }
  }

  Future<Map<String, dynamic>> requestPayout({
    required double amount,
    String? upiId,
    String? bankAccount,
    String? ifsc,
    String? accountHolder,
  }) async {
    try {
      final res = await _dio.post('/payout', data: {
        'amount': amount,
        if (upiId != null) 'upi_id': upiId.trim(),
        if (bankAccount != null) 'bank_account': bankAccount.trim(),
        if (ifsc != null) 'ifsc': ifsc.trim(),
        if (accountHolder != null) 'account_holder': accountHolder.trim(),
      });
      return res.data;
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Payout request failed');
    }
  }

  // 9. Notifications
  Future<Map<String, dynamic>> getNotifications() async {
    try {
      final res = await _dio.get('/notifications');
      final list = (res.data['notifications'] as List<dynamic>? ?? [])
          .map((n) => AgentNotificationItem.fromJson(n as Map<String, dynamic>))
          .toList();
      final unread = (res.data['unread_count'] as num?)?.toInt() ?? 0;
      return {'notifications': list, 'unread_count': unread};
    } on DioException catch (e) {
      return {'notifications': <AgentNotificationItem>[], 'unread_count': 0};
    }
  }

  Future<void> markNotificationsRead({String? id}) async {
    try {
      await _dio.post('/notifications/mark-read', data: {if (id != null) 'id': id});
    } catch (_) {}
  }

  // 10. Change Password
  Future<void> changePassword(String currentPassword, String newPassword) async {
    try {
      await _dio.post('/change-password', data: {
        'current_password': currentPassword,
        'new_password': newPassword,
      });
    } on DioException catch (e) {
      throw Exception(e.response?.data?['error'] ?? 'Failed to update password');
    }
  }
}

