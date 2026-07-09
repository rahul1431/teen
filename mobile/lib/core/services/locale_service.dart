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
    AppLanguage('te', 'Telugu', 'తెలుగు', '🇮🇳'),
    AppLanguage('kn', 'Kannada', 'ಕನ್ನಡ', '🇮🇳'),
    AppLanguage('mr', 'Marathi', 'मराठी', '🇮🇳'),
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
    'te': {
      'profile': 'ప్రొఫైల్',
      'bank_details': 'బ్యాంక్ వివరాలు',
      'transaction_history': 'లావాదేవీల చరిత్ర',
      'support': 'మద్దతు',
      'language': 'భాష',
      'biometric_login': 'బయోమెట్రిక్ లాగిన్',
      'enable_biometric': 'వేలిముద్రతో యాప్ తెరవండి',
      'logout': 'లాగ్ అవుట్',
      'choose_language': 'మీ భాషను ఎంచుకోండి',
      'continue': 'కొనసాగించు',
    },
    'kn': {
      'profile': 'ಪ್ರೊಫೈಲ್',
      'bank_details': 'ಬ್ಯಾಂಕ್ ವಿವರಗಳು',
      'transaction_history': 'ವಹಿವಾಟು ಇತಿಹಾಸ',
      'support': 'ಬೆಂಬಲ',
      'language': 'ಭಾಷೆ',
      'biometric_login': 'ಬಯೋಮೆಟ್ರಿಕ್ ಲಾಗಿನ್',
      'enable_biometric': 'ಫಿಂಗರ್‌ಪ್ರಿಂಟ್‌ನೊಂದಿಗೆ ಆ್ಯಪ್ ತೆರೆಯಿರಿ',
      'logout': 'ಲಾಗ್ ಔಟ್',
      'choose_language': 'ನಿಮ್ಮ ಭಾಷೆಯನ್ನು ಆರಿಸಿ',
      'continue': 'ಮುಂದುವರಿಸಿ',
    },
    'mr': {
      'profile': 'प्रोफाइल',
      'bank_details': 'बँक तपशील',
      'transaction_history': 'व्यवहार इतिहास',
      'support': 'सहाय्य',
      'language': 'भाषा',
      'biometric_login': 'बायोमेट्रिक लॉगिन',
      'enable_biometric': 'फिंगरप्रिंटने अ‍ॅप उघडा',
      'logout': 'लॉग आउट',
      'choose_language': 'तुमची भाषा निवडा',
      'continue': 'पुढे चला',
    },
  };
}

final locale = LocaleService();
