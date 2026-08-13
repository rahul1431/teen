import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  static const background    = Color(0xFF0D1117);
  static const surface       = Color(0xFF161B22);
  static const cardBg        = Color(0xFF1E2533);
  static const gold          = Color(0xFFD4AF37);
  static const goldLight     = Color(0xFFFFD700);
  static const green         = Color(0xFF00C853);
  static const red           = Color(0xFFFF1744);
  static const orange        = Color(0xFFFF6D00);
  static const blue          = Color(0xFF2196F3);
  static const purple        = Color(0xFF9C27B0);
  static const textPrimary   = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xFF8B949E);
  static const border        = Color(0xFF30363D);

  // Game card gradients
  static const List<Color> teenPattiGrad  = [Color(0xFFB11226), Color(0xFF6B0012)];
  static const List<Color> aviatorGrad    = [Color(0xFF1E3A8A), Color(0xFF0B1E52)];
  static const List<Color> premiumGrad    = [Color(0xFFB8870B), Color(0xFF7A5A00)];
  static const List<Color> variationsGrad = [Color(0xFF0E5C2F), Color(0xFF07311A)];
  static const List<Color> ludoGrad       = [Color(0xFF6A1B9A), Color(0xFF311B5E)];
  static const List<Color> matkaGrad      = [Color(0xFFC2410C), Color(0xFF7A2208)];
  static const List<Color> lotteryGrad    = [Color(0xFF0D9488), Color(0xFF064E45)];
  static const List<Color> cricketGrad    = [Color(0xFF15803D), Color(0xFF0A4521)];
  static const List<Color> rummyGrad      = [Color(0xFF0F766E), Color(0xFF042F2B)];

  // Ludo token colours (seat order). Values match the board's tuned "reference
  // board" palette in ludo_board.dart so avatars/chips/borders elsewhere on the
  // Ludo screen always match the actual tokens on the board.
  static const ludoRed    = Color(0xFFEC2D2D);
  static const ludoGreen  = Color(0xFF1BA64F);
  static const ludoYellow = Color(0xFFFCC900);
  static const ludoBlue   = Color(0xFF29ABE2);

  // Table felt
  static const feltDark    = Color(0xFF0A1428);
  static const feltRed     = Color(0xFFB11226);
  static const feltRedDark = Color(0xFF7A0C1A);
  static const tableNavy   = Color(0xFF1C2C57);

  // Aviator
  static const aviatorBlue  = Color(0xFF1E3A8A);
  static const aviatorGreen = Color(0xFF00C853);

  // Cricket — pitch/stadium accent layered on the dark base + gold accent.
  // Distinguishes cricket's fantasy-sports identity from the felt-table
  // games while staying inside the same dark/gold visual language.
  static const pitchGreen      = Color(0xFF1BA352);
  static const pitchGreenLight = Color(0xFF3ED97C);
  static const pitchDark       = Color(0xFF0A2E1A);
  static const floodlight      = Color(0xFFFFF3C4);
  static const stadiumNavy     = Color(0xFF0B1A2E);
}

class AppTheme {
  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: const ColorScheme.dark(
      primary: AppColors.gold,
      secondary: AppColors.goldLight,
      surface: AppColors.surface,
      onPrimary: Colors.black,
      onSurface: AppColors.textPrimary,
    ),
    textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme).apply(
      bodyColor: AppColors.textPrimary,
      displayColor: AppColors.textPrimary,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.surface,
      elevation: 0,
      centerTitle: true,
      titleTextStyle: TextStyle(color: AppColors.gold, fontSize: 18, fontWeight: FontWeight.bold),
      iconTheme: IconThemeData(color: AppColors.gold),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.gold,
        foregroundColor: Colors.black,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 32),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.gold,
        side: const BorderSide(color: AppColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 32),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
      ),
    ),
    cardTheme: CardThemeData(
      color: AppColors.cardBg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      elevation: 0,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.gold, width: 2)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.red)),
      focusedErrorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: AppColors.red, width: 2)),
      labelStyle: const TextStyle(color: AppColors.textSecondary),
      hintStyle: const TextStyle(color: AppColors.textSecondary),
      errorStyle: const TextStyle(color: AppColors.red, fontSize: 12),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.surface,
      selectedItemColor: AppColors.gold,
      unselectedItemColor: AppColors.textSecondary,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
      selectedLabelStyle: TextStyle(fontSize: 11, fontWeight: FontWeight.bold),
      unselectedLabelStyle: TextStyle(fontSize: 11),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, space: 1, thickness: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.cardBg,
      contentTextStyle: const TextStyle(color: AppColors.textPrimary),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      behavior: SnackBarBehavior.floating,
    ),
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

class AppSnackBar {
  static void show(BuildContext ctx, String msg, {bool error = false, bool success = false}) {
    final color = error ? AppColors.red : success ? AppColors.green : AppColors.cardBg;
    ScaffoldMessenger.of(ctx)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(msg),
        backgroundColor: color,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ));
  }
}

String formatCurrency(dynamic value) {
  final v = double.tryParse(value.toString()) ?? 0;
  if (v >= 10000000) return '₹${(v / 10000000).toStringAsFixed(2)}Cr';
  if (v >= 100000)   return '₹${(v / 100000).toStringAsFixed(2)}L';
  if (v >= 1000)     return '₹${(v / 1000).toStringAsFixed(1)}K';
  return '₹${v.toStringAsFixed(2)}';
}

String timeAgo(String isoDate) {
  try {
    final dt = DateTime.parse(isoDate).toLocal();
    final diff = DateTime.now().difference(dt);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24)   return '${diff.inHours}h ago';
    if (diff.inDays < 7)     return '${diff.inDays}d ago';
    return '${dt.day}/${dt.month}/${dt.year}';
  } catch (_) { return ''; }
}
