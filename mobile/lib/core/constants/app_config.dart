class AppConfig {
  // These are overwritten by GitHub Actions during APK build
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://game.myonlinejoker.com',
  );
  static const String socketUrl = String.fromEnvironment(
    'SOCKET_URL',
    defaultValue: 'http://game.myonlinejoker.com',
  );
  static const String razorpayKeyId = String.fromEnvironment(
    'RAZORPAY_KEY_ID',
    defaultValue: 'rzp_test_placeholder',
  );
  static const String appName = 'MyOnlineJoker';
  static const String appVersion = '1.0.0';
}
