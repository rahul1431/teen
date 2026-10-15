import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:intl/intl.dart';
import '../constants/app_config.dart';

class AppConfigService {
  static final AppConfigService instance = AppConfigService._internal();
  factory AppConfigService() => instance;
  AppConfigService._internal();

  static const String boxName = 'app_config_cache';

  // ValueNotifier to allow UI widgets to rebuild when config loads or updates
  static final ValueNotifier<int> changeNotifier = ValueNotifier<int>(0);

  // Compile-time Play Store build flag (defaults to true for release builds to ensure 100% compliance)
  static const bool isPlayStoreBuild = bool.fromEnvironment('PLAYSTORE_BUILD', defaultValue: true);

  // In-memory flags with safe defaults (Play Store safe defaults)
  static String _mode = 'safe'; // 'safe' | 'full'
  static String? _devOverrideMode; // null, 'safe', or 'full' (for internal QA testing)
  static bool _depositEnabled = false;
  static bool _withdrawalEnabled = false;
  static String _currencySymbol = '🪙';
  static String _cashierUrl = '';
  static String _kycUrl = '';

  static Map<String, bool> _games = {
    'teen_patti': true,
    'ludo': true,
    'rummy': true,
    'cricket': false,
    'lottery': false,
    'matka': false,
    'aviator': false,
    'color_prediction': false,
  };

  static bool isSafeMode() {
    if (_devOverrideMode != null) return _devOverrideMode == 'safe';
    return _mode == 'safe';
  }

  static bool isWalletEnabled() {
    if (isSafeMode()) return false;
    return _depositEnabled || _withdrawalEnabled;
  }

  static bool isDepositEnabled() => !isSafeMode() && _depositEnabled;
  static bool isWithdrawalEnabled() => !isSafeMode() && _withdrawalEnabled;

  static bool isGameEnabled(String gameType) {
    if (isSafeMode()) {
      return gameType == 'ludo';
    }
    if (gameType == 'sports' || gameType == 'cricket') {
      return _games['sports'] ?? _games['cricket'] ?? true;
    }
    return _games[gameType] ?? true;
  }

  static String getCurrencySymbol() => isSafeMode() ? '🪙' : _currencySymbol;

  static String formatCurrency(num amount, {bool showSymbol = true}) {
    final numFormat = NumberFormat('#,##,###.##', 'en_IN');
    final intFormat = NumberFormat('#,##,###', 'en_IN');
    final val = amount % 1 == 0 ? intFormat.format(amount.toInt()) : numFormat.format(amount);
    if (isSafeMode()) {
      return showSymbol ? '$val 🪙' : val;
    }
    final sym = getCurrencySymbol();
    return showSymbol ? '$sym$val' : val;
  }

  static String getSafeBalanceText([String? realBalance]) {
    if (isSafeMode()) return '10,000 🪙';
    final sym = getCurrencySymbol();
    return '$sym${realBalance ?? '0'}';
  }

  static bool shouldPlayOffline() => isSafeMode();

  static String getCashierUrl() => _cashierUrl;
  static String getKycUrl() => _kycUrl;
  static String? getDevOverride() => _devOverrideMode;

  static Future<void> toggleDevMode() async {
    final currentlySafe = isSafeMode();
    _devOverrideMode = currentlySafe ? 'full' : 'safe';
    if (_devOverrideMode == 'full') {
      _mode = 'full';
      _currencySymbol = '₹';
      _depositEnabled = true;
      _withdrawalEnabled = true;
      _games = {
        'teen_patti': true,
        'ludo': true,
        'rummy': true,
        'cricket': true,
        'lottery': true,
        'matka': true,
        'aviator': true,
        'color_prediction': true,
      };
    } else {
      _mode = 'safe';
      _currencySymbol = '🪙';
      _depositEnabled = false;
      _withdrawalEnabled = false;
    }
    try {
      final box = Hive.isBoxOpen(boxName) ? Hive.box(boxName) : await Hive.openBox(boxName);
      await box.put('dev_override_mode', _devOverrideMode);
    } catch (_) {}
    changeNotifier.value++;
  }

  static Future<void> resetDevOverride() async {
    _devOverrideMode = null;
    try {
      final box = Hive.isBoxOpen(boxName) ? Hive.box(boxName) : await Hive.openBox(boxName);
      await box.delete('dev_override_mode');
    } catch (_) {}
    changeNotifier.value++;
  }

  static Future<void> init() async {
    try {
      final box = await Hive.openBox(boxName);
      _devOverrideMode = box.get('dev_override_mode');
      if (_devOverrideMode == 'full') {
        _mode = 'full';
        _currencySymbol = '₹';
        _depositEnabled = true;
        _withdrawalEnabled = true;
        _games = {
          'teen_patti': true,
          'ludo': true,
          'rummy': true,
          'cricket': true,
          'lottery': true,
          'matka': true,
          'aviator': true,
          'color_prediction': true,
        };
      } else {
        _mode = box.get('app_mode', defaultValue: 'safe');
        _depositEnabled = box.get('wallet_deposit_enabled', defaultValue: false);
        _withdrawalEnabled = box.get('wallet_withdrawal_enabled', defaultValue: false);
        _currencySymbol = box.get('currency_symbol', defaultValue: _mode == 'safe' ? '🪙' : '₹');
      }
      _cashierUrl = box.get('cashier_url', defaultValue: '');
      if (_cashierUrl.contains('game.myonlinejoker.com/cashier')) _cashierUrl = '';
      _kycUrl = box.get('kyc_url', defaultValue: '');
      if (_kycUrl.contains('game.myonlinejoker.com/cashier/kyc')) _kycUrl = '';

      final cachedGames = box.get('games_enabled');
      if (cachedGames is Map) {
        _games = Map<String, bool>.from(
          cachedGames.map((k, v) => MapEntry(k.toString(), v == true)),
        );
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[AppConfigService] init error: $e');
    }
  }

  static Future<void> fetchRemoteConfig() async {
    try {
      final dio = Dio(BaseOptions(
        baseUrl: AppConfig.apiBaseUrl.trim(),
        connectTimeout: const Duration(seconds: 8),
        receiveTimeout: const Duration(seconds: 8),
      ));

      // Resolve version code and logged-in phone to evaluate reviewer/tester gating
      String versionCode = '0';
      try {
        final pkg = await PackageInfo.fromPlatform();
        versionCode = pkg.buildNumber;
      } catch (_) {}

      String userPhone = '';
      try {
        final prefs = await SharedPreferences.getInstance();
        userPhone = prefs.getString('user_phone') ?? '';
      } catch (_) {}

      final res = await dio.get('/api/app/config', queryParameters: {
        'version': versionCode,
        'phone': userPhone,
      });

      if (res.statusCode == 200 && res.data != null) {
        final data = res.data;
        if (_devOverrideMode == 'full') {
          _mode = 'full';
          _currencySymbol = '₹';
          _depositEnabled = true;
          _withdrawalEnabled = true;
        } else if (_devOverrideMode == 'safe') {
          _mode = 'safe';
          _currencySymbol = '🪙';
          _depositEnabled = false;
          _withdrawalEnabled = false;
        } else {
          _mode = (data['mode'] as String?) ?? 'safe';
          _currencySymbol = (data['currency_symbol'] as String?) ?? (_mode == 'safe' ? '🪙' : '₹');

          final wallet = data['wallet'] as Map<String, dynamic>?;
          if (wallet != null) {
            _depositEnabled = wallet['deposit_enabled'] == true;
            _withdrawalEnabled = wallet['withdrawal_enabled'] == true;
          }
        }

        final urls = data['urls'] as Map<String, dynamic>?;
        if (urls != null) {
          if (urls['cashier_url'] != null) {
            final val = urls['cashier_url'].toString().trim();
            _cashierUrl = val.contains('game.myonlinejoker.com/cashier') ? '' : val;
          }
          if (urls['kyc_url'] != null) {
            final val = urls['kyc_url'].toString().trim();
            _kycUrl = val.contains('game.myonlinejoker.com/cashier/kyc') ? '' : val;
          }
        }

        final games = data['games'] as Map<String, dynamic>?;
        if (games != null) {
          _games = games.map((k, v) => MapEntry(k, v == true));
        }

        // Persist to Hive box
        if (Hive.isBoxOpen(boxName)) {
          final box = Hive.box(boxName);
          await box.put('app_mode', _mode);
          await box.put('currency_symbol', _currencySymbol);
          await box.put('cashier_url', _cashierUrl);
          await box.put('kyc_url', _kycUrl);
          await box.put('wallet_deposit_enabled', _depositEnabled);
          await box.put('wallet_withdrawal_enabled', _withdrawalEnabled);
          await box.put('games_enabled', _games);
        }

        changeNotifier.value++;
      }
    } catch (e) {
      if (kDebugMode) debugPrint('[AppConfigService] fetchRemoteConfig error: $e');
    }
  }
}
