import 'package:flutter/foundation.dart';

/// App-wide wallet balance shared between pages and the AppShell top bar.
/// Pages that fetch /api/wallet/balance push the fresh values here; the
/// shell's balance chip listens and updates without its own polling.
class BalanceService {
  BalanceService._();
  static final BalanceService instance = BalanceService._();

  final ValueNotifier<double> real = ValueNotifier(0);
  final ValueNotifier<double> bonus = ValueNotifier(0);

  void set({double? realBalance, double? bonusBalance}) {
    if (realBalance != null) real.value = realBalance;
    if (bonusBalance != null) bonus.value = bonusBalance;
  }
}
