import 'package:hive_flutter/hive_flutter.dart';

class AppLanguage {
  final String code;
  final String name;
  final String nativeName;
  final String flag;
  const AppLanguage(this.code, this.name, this.nativeName, this.flag);
}

/// Lightweight in-app localization. Language choice persists in the Hive
/// 'settings' box (opened in main.dart before locale.load() runs).
class LocaleService {
  static const _boxName = 'settings';
  static const _localeKey = 'locale_code';
  static const _firstLaunchKey = 'first_launch_done';

  static const languages = [
    AppLanguage('en', 'English', 'English', '🇬🇧'),
    AppLanguage('hi', 'Hindi', 'हिन्दी', '🇮🇳'),
  ];

  AppLanguage _current = languages.first;
  AppLanguage get current => _current;

  Future<void> load() async {
    try {
      final code = Hive.box(_boxName).get(_localeKey) as String?;
      _current = languages.firstWhere((l) => l.code == code,
          orElse: () => languages.first);
    } catch (_) {
      _current = languages.first;
    }
  }

  Future<void> setLanguage(String code) async {
    _current = languages.firstWhere((l) => l.code == code,
        orElse: () => languages.first);
    try {
      await Hive.box(_boxName).put(_localeKey, _current.code);
    } catch (_) {}
  }

  static Future<bool> isFirstLaunch() async {
    try {
      return !(Hive.box(_boxName).get(_firstLaunchKey, defaultValue: false) as bool);
    } catch (_) {
      return false; // if storage is unavailable, don't trap users in onboarding
    }
  }

  static Future<void> markFirstLaunchDone() async {
    try {
      await Hive.box(_boxName).put(_firstLaunchKey, true);
    } catch (_) {}
  }

  String t(String key) => _translations[_current.code]?[key] ?? _translations['en']![key] ?? key;

  static const _translations = <String, Map<String, String>>{
    'en': {
      'profile': 'Profile',
      'bank_details': 'Bank Details',
      'transaction_history': 'Transaction History',
      'support': 'Support',
      'language': 'Language',
      'biometric_login': 'Biometric Login',
      'enable_biometric': 'Unlock app with fingerprint',
      'logout': 'Logout',
      'choose_language': 'Choose Your Language',
      'continue': 'Continue',
    },
    'hi': {
      'profile': 'प्रोफ़ाइल',
      'bank_details': 'बैंक विवरण',
      'transaction_history': 'लेन-देन इतिहास',
      'support': 'सहायता',
      'language': 'भाषा',
      'biometric_login': 'बायोमेट्रिक लॉगिन',
      'enable_biometric': 'फिंगरप्रिंट से ऐप खोलें',
      'logout': 'लॉग आउट',
      'choose_language': 'अपनी भाषा चुनें',
      'continue': 'आगे बढ़ें',
    },
  };
}

final locale = LocaleService();
