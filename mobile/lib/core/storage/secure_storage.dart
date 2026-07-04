import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStorage {
  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _keyAccessToken = 'access_token';
  static const _keyRefreshToken = 'refresh_token';
  static const _keyUserId = 'user_id';
  static const _keyUsername = 'username';

  static Future<void> saveTokens({required String accessToken, required String refreshToken}) async {
    await Future.wait([
      _storage.write(key: _keyAccessToken, value: accessToken),
      _storage.write(key: _keyRefreshToken, value: refreshToken),
    ]);
  }

  static Future<String?> getAccessToken() => _storage.read(key: _keyAccessToken);
  static Future<String?> getRefreshToken() => _storage.read(key: _keyRefreshToken);

  static Future<void> saveUser({required String userId, required String username}) async {
    await Future.wait([
      _storage.write(key: _keyUserId, value: userId),
      _storage.write(key: _keyUsername, value: username),
    ]);
  }

  static Future<String?> getUserId() => _storage.read(key: _keyUserId);
  static Future<String?> getUsername() => _storage.read(key: _keyUsername);

  static Future<void> saveBiometricCredentials(String phone, String password) async {
    await Future.wait([
      _storage.write(key: 'bio_phone', value: phone),
      _storage.write(key: 'bio_password', value: password),
    ]);
  }

  static Future<Map<String, String>?> getBiometricCredentials() async {
    final phone = await _storage.read(key: 'bio_phone');
    final password = await _storage.read(key: 'bio_password');
    if (phone != null && password != null) {
      return {'phone': phone, 'password': password};
    }
    return null;
  }

  static Future<void> clearBiometricCredentials() async {
    await Future.wait([
      _storage.delete(key: 'bio_phone'),
      _storage.delete(key: 'bio_password'),
    ]);
  }

  static Future<void> clearAll() async {
    await Future.wait([
      _storage.delete(key: _keyAccessToken),
      _storage.delete(key: _keyRefreshToken),
      _storage.delete(key: _keyUserId),
      _storage.delete(key: _keyUsername),
    ]);
  }
}
