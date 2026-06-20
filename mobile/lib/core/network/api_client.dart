import 'package:dio/dio.dart';
import '../constants/app_config.dart';
import '../storage/secure_storage.dart';

class ApiClient {
  static final ApiClient _instance = ApiClient._internal();
  factory ApiClient() => _instance;

  late final Dio dio;

  ApiClient._internal() {
    dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 15),
      headers: {'Content-Type': 'application/json'},
    ));

    dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await SecureStorage.getAccessToken();
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (err, handler) async {
        if (err.response?.statusCode == 401) {
          final refreshed = await _refreshToken();
          if (refreshed) {
            final token = await SecureStorage.getAccessToken();
            err.requestOptions.headers['Authorization'] = 'Bearer $token';
            final response = await dio.fetch(err.requestOptions);
            return handler.resolve(response);
          } else {
            await SecureStorage.clearAll();
          }
        }
        handler.next(err);
      },
    ));
  }

  Future<bool> _refreshToken() async {
    try {
      final refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken == null) return false;
      final res = await Dio().post('${AppConfig.apiBaseUrl}/api/auth/refresh', data: {'refresh_token': refreshToken});
      await SecureStorage.saveTokens(
        accessToken: res.data['access_token'],
        refreshToken: refreshToken,
      );
      return true;
    } catch (_) {
      return false;
    }
  }
}
