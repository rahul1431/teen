import 'dart:io';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:hive/hive.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:gal/gal.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../../core/services/balance_service.dart';
import '../../core/services/app_config_service.dart';
import '../../core/analytics/product_analytics.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/cms_banner_strip.dart';
import '../profile/kyc_page.dart';
import '../profile/bank_details_page.dart';

// Resolve a possibly-relative server path (e.g. /uploads/qr/x.png) to a full URL.
String _resolveUrl(String? p) {
  if (p == null || p.isEmpty) return '';
  if (p.startsWith('http')) return p;
  return '${AppConfig.apiBaseUrl}$p';
}

class WalletPage extends StatefulWidget {
  const WalletPage({super.key});
  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  final _api = ApiClient();
  String _realBalance = '0.00';
  String _bonusBalance = '0.00';
  List<dynamic> _transactions = [];

  @override
  void initState() {
    super.initState();
    _loadCachedData();
    _loadData();
  }

  void _loadCachedData() {
    try {
      final box = Hive.box('wallet');
      final cachedReal = box.get('real_balance')?.toString();
      final cachedBonus = box.get('bonus_balance')?.toString();
      if (cachedReal != null || cachedBonus != null) {
        setState(() {
          if (cachedReal != null) _realBalance = cachedReal;
          if (cachedBonus != null) _bonusBalance = cachedBonus;
        });
      }
    } catch (_) {}
  }

  Future<void> _loadData() async {
    try {
      final [balRes, txnRes] = await Future.wait([
        _api.dio.get('/api/wallet/balance'),
        _api.dio.get('/api/wallet/transactions?limit=20'),
      ]);
      final real = double.parse(balRes.data['real_balance'].toString())
          .toStringAsFixed(2);
      final bonus = double.parse(balRes.data['bonus_balance'].toString())
          .toStringAsFixed(2);
      setState(() {
        _realBalance = real;
        _bonusBalance = bonus;
        _transactions = txnRes.data;
      });
      BalanceService.instance.set(
        realBalance: double.tryParse(real),
        bonusBalance: double.tryParse(bonus),
      );
      try {
        final box = Hive.box('wallet');
        box.put('real_balance', real);
        box.put('bonus_balance', bonus);
      } catch (_) {}
    } catch (_) {
      if (mounted)
        AppSnackBar.show(context, 'Could not load wallet data', error: true);
    }
  }

  void _showError(String msg) => AppSnackBar.show(context, msg, error: true);
  void _showSuccess(String msg) =>
      AppSnackBar.show(context, msg, success: true);

  Color _txnColor(String type) {
    if (type.contains('credit') ||
        type == 'deposit' ||
        type == 'game_credit' ||
        type == 'bonus' ||
        type == 'referral') return AppColors.green;
    return AppColors.red;
  }

  Widget _buildStatusBadge(String? status) {
    if (status == null || status == 'completed') return const SizedBox.shrink();
    Color color;
    String label;
    if (status == 'pending') {
      color = AppColors.orange;
      label = 'PENDING';
    } else if (status == 'reversed') {
      color = AppColors.purple;
      label = 'REVERSED';
    } else if (status == 'failed') {
      color = AppColors.red;
      label = 'FAILED';
    } else {
      color = AppColors.textSecondary;
      label = status.toUpperCase();
    }

    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.5), width: 0.5),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 8.5,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Future<void> _openDeposit() async {
    ProductAnalytics.instance.track('deposit_screen_opened');
    final cashierUrl = AppConfigService.getCashierUrl();
    if (cashierUrl.isNotEmpty && !cashierUrl.contains('game.myonlinejoker.com/cashier')) {
      final uri = Uri.tryParse(cashierUrl);
      if (uri != null) {
        await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
        return;
      }
    }
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _DepositSheet(api: _api),
    );
    if (ok == true) {
      _showSuccess(
          'Deposit submitted for review. Balance updates after admin approval.');
      _loadData();
    }
  }

  Future<void> _openWithdraw() async {
    final cashierUrl = AppConfigService.getCashierUrl();
    if (cashierUrl.isNotEmpty && !cashierUrl.contains('game.myonlinejoker.com/cashier')) {
      final uri = Uri.tryParse(cashierUrl);
      if (uri != null) {
        await launchUrl(uri, mode: LaunchMode.inAppBrowserView);
        return;
      }
    }
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _WithdrawSheet(api: _api, balance: _realBalance),
    );
    if (ok == true) {
      _showSuccess('Withdrawal request submitted. Processed within 24 hours.');
      _loadData();
    }
  }

  Widget _buildSafeModeRewardsView() {
    return Scaffold(
      appBar: AppBar(
        title: const Text('🎁 Daily Rewards'),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF1E2533), Color(0xFF141922)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Free Play Balance',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                const SizedBox(height: 6),
                const Text(
                  '10,000 🪙',
                  style: TextStyle(
                      fontSize: 36,
                      fontWeight: FontWeight.bold,
                      color: AppColors.gold),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Virtual play chips for casual card and board games with friends.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.cardBg,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(Icons.card_giftcard_rounded, color: AppColors.gold, size: 22),
                    SizedBox(width: 10),
                    Text('Daily Check-in Bonus',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'Claim your free 1,000 play coins every day to keep enjoying Teen Patti, Rummy, and Ludo!',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () {
                      AppSnackBar.show(context, '🎉 +1,000 Free Play Coins claimed!', success: true);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.gold,
                      foregroundColor: Colors.black,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: const Text('Claim Daily 1,000 Coins',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.cardBg,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.verified_user_rounded, color: AppColors.green, size: 20),
                    SizedBox(width: 10),
                    Text('Fair Play & Social Gaming',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                  ],
                ),
                SizedBox(height: 8),
                Text(
                  'MyOnlineJoker is a social gaming platform. All games use virtual play coins for entertainment with friends and family.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (AppConfigService.isSafeMode()) {
      return _buildSafeModeRewardsView();
    }
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Balance card
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                    colors: [AppColors.cardBg, AppColors.surface]),
                borderRadius: BorderRadius.circular(20),
                border:
                    Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Total Balance',
                      style: TextStyle(color: AppColors.textSecondary)),
                  Text(
                    formatCurrency((double.tryParse(_realBalance) ?? 0) + (double.tryParse(_bonusBalance) ?? 0)),
                    style: const TextStyle(
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                        color: AppColors.gold),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Withdrawable',
                                style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 11)),
                            const SizedBox(height: 2),
                            Text(formatCurrency(double.tryParse(_realBalance) ?? 0),
                                style: const TextStyle(
                                    color: AppColors.green,
                                    fontWeight: FontWeight.w700,
                                    fontSize: 15)),
                          ],
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Bonus · not withdrawable',
                                style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 11)),
                            const SizedBox(height: 2),
                            Text(formatCurrency(double.tryParse(_bonusBalance) ?? 0),
                                style: const TextStyle(
                                    color: AppColors.orange,
                                    fontWeight: FontWeight.w700,
                                    fontSize: 15)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),

            // Action buttons
            ValueListenableBuilder<int>(
              valueListenable: AppConfigService.changeNotifier,
              builder: (context, _, __) {
                final depositOn = AppConfigService.isDepositEnabled();
                final withdrawOn = AppConfigService.isWithdrawalEnabled();

                if (!depositOn && !withdrawOn) {
                  return Container(
                    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.04),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.info_outline, size: 16, color: AppColors.textSecondary),
                        SizedBox(width: 8),
                        Text(
                          'Wallet operations are currently undergoing scheduled maintenance.',
                          style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  );
                }

                return Row(
                  children: [
                    if (depositOn)
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _openDeposit,
                          icon: const Icon(Icons.add),
                          label: const Text('Add Money'),
                        ),
                      ),
                    if (depositOn && withdrawOn) const SizedBox(width: 12),
                    if (withdrawOn)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _openWithdraw,
                          icon: const Icon(Icons.account_balance),
                          label: const Text('Withdraw'),
                        ),
                      ),
                  ],
                );
              },
            ),
            const SizedBox(height: 16),
            const CmsBannerStrip(placement: 'wallet'),
            const SizedBox(height: 8),

            // Transaction history
            const Text('Recent Transactions',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (_transactions.isEmpty)
              const Center(
                  child: Text('No transactions yet',
                      style: TextStyle(color: AppColors.textSecondary)))
            else
              ..._transactions.map((txn) => ListTile(
                    contentPadding:
                        const EdgeInsets.symmetric(horizontal: 0, vertical: 4),
                    leading: CircleAvatar(
                      backgroundColor:
                          _txnColor(txn['type']).withValues(alpha: 0.15),
                      child: Icon(
                          txn['type'].contains('credit') ||
                                  txn['type'] == 'deposit'
                              ? Icons.add
                              : Icons.remove,
                          color: _txnColor(txn['type'])),
                    ),
                    title: Row(
                      children: [
                        Text(
                            txn['type']
                                .toString()
                                .replaceAll('_', ' ')
                                .toUpperCase(),
                            style: const TextStyle(
                                fontSize: 13, fontWeight: FontWeight.w600)),
                        _buildStatusBadge(txn['status']?.toString()),
                      ],
                    ),
                    subtitle: Text(DateTime.parse(txn['created_at'])
                        .toLocal()
                        .toString()
                        .substring(0, 16)),
                    trailing: Text(
                      '${_txnColor(txn['type']) == AppColors.green ? '+' : '-'}₹${double.parse(txn['amount'].toString()).toStringAsFixed(2)}',
                      style: TextStyle(
                          color: _txnColor(txn['type']),
                          fontWeight: FontWeight.bold),
                    ),
                  )),
          ],
        ),
      ),
    );
  }
}

// ---- Deposit sheet: choose method, pay manually, submit reference + screenshot ----
class _DepositSheet extends StatefulWidget {
  final ApiClient api;
  const _DepositSheet({required this.api});
  @override
  State<_DepositSheet> createState() => _DepositSheetState();
}

class _DepositSheetState extends State<_DepositSheet> {
  List<dynamic> _methods = [];
  Map<String, dynamic>? _selected;
  bool _loading = true;
  bool _submitting = false;
  int _activeTab = 0; // 0: ⚡ Instant UPI, 1: 📸 Manual Transfer / QR
  bool _youpiLoading = false;
  static const _presetAmounts = [100, 200, 500, 1000, 2000, 5000];
  final _amountCtrl = TextEditingController(text: '100');
  final _refCtrl = TextEditingController();
  final _promoCtrl = TextEditingController();
  XFile? _screenshot;
  Map<String, dynamic>? _promoResult;
  bool _validatingPromo = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _startInstantUpi() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 10) {
      _snack('Enter a valid amount (min ₹10)', AppColors.red);
      return;
    }
    setState(() => _youpiLoading = true);
    try {
      final res = await widget.api.dio.post('/api/wallet/youpi/create-order', data: {
        'amount': amount,
        if (_promoCtrl.text.trim().isNotEmpty) 'promo_code': _promoCtrl.text.trim().toUpperCase(),
      });
      final data = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      final orderId = data['order_id']?.toString() ?? '';
      final upiIntentUrl = data['upi_intent_url']?.toString() ?? '';
      final vpa = data['vpa']?.toString() ?? '';
      final merchantName = data['merchant_name']?.toString() ?? 'My Online Joker';

      final checkoutUrl = data['checkout_url']?.toString() ?? 'https://wallet.myonlinejoker.com/checkout/$orderId';

      if (mounted) setState(() => _youpiLoading = false);

      // Launch UPI Intent into PhonePe/GPay/Paytm if available
      if (upiIntentUrl.isNotEmpty) {
        try {
          await launchUrl(Uri.parse(upiIntentUrl), mode: LaunchMode.externalApplication);
        } catch (_) {}
      }

      // Show real-time waiting dialog
      if (mounted) {
        _showWaitingDialog(orderId, amount, upiIntentUrl, vpa, merchantName, checkoutUrl);
      }
    } catch (e) {
      if (mounted) setState(() => _youpiLoading = false);
      final msg = e is DioException
          ? (e.response?.data?['error']?.toString() ?? 'Failed to initiate instant payment')
          : 'Payment failed to initiate';
      _snack(msg, AppColors.red);
    }
  }

  void _showWaitingDialog(String orderId, double amount, String upiIntentUrl, String vpa, String merchantName, [String checkoutUrl = '']) {
    Timer? pollTimer;
    final manualUtrCtrl = TextEditingController();
    bool verifyingUtr = false;
    bool dialogClosed = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (bCtx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            pollTimer ??= Timer.periodic(const Duration(seconds: 2), (t) async {
              if (dialogClosed) {
                t.cancel();
                return;
              }
              try {
                final sRes = await widget.api.dio.get('/api/wallet/youpi/order/$orderId/status');
                final sData = sRes.data is Map ? Map<String, dynamic>.from(sRes.data as Map) : <String, dynamic>{};
                if (sData['status'] == 'SUCCESS') {
                  t.cancel();
                  if (!dialogClosed) {
                    dialogClosed = true;
                    Navigator.pop(ctx);
                    if (mounted) {
                      _snack('🎉 ₹${amount.toStringAsFixed(2)} credited to your wallet instantly! ⚡', AppColors.green);
                      Navigator.pop(context, true);
                    }
                  }
                }
              } catch (_) {}
            });

            return Padding(
              padding: EdgeInsets.only(
                left: 20, right: 20, top: 20,
                bottom: 20 + MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 40, height: 4,
                      decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2)),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: const [
                        Icon(Icons.bolt, color: AppColors.gold, size: 28),
                        SizedBox(width: 8),
                        Text('Instant UPI Auto-Credit', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.white)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text('Order: $orderId', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    const SizedBox(height: 8),
                    Text('₹${amount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: AppColors.gold)),
                    const SizedBox(height: 12),

                    Center(
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: QrImageView(
                          data: upiIntentUrl,
                          size: 150,
                          backgroundColor: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text('Scan with any UPI app or tap button below', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                    const SizedBox(height: 12),

                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.gold,
                          foregroundColor: Colors.black,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () {
                          launchUrl(Uri.parse(upiIntentUrl), mode: LaunchMode.externalApplication);
                        },
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: const Text('Open UPI App (PhonePe / GPay / Paytm)', style: TextStyle(fontWeight: FontWeight.bold)),
                      ),
                    ),
                    if (checkoutUrl.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: Colors.white24),
                            padding: const EdgeInsets.symmetric(vertical: 10),
                          ),
                          onPressed: () {
                            launchUrl(Uri.parse(checkoutUrl), mode: LaunchMode.externalApplication);
                          },
                          icon: const Icon(Icons.language, size: 16, color: AppColors.gold),
                          label: const Text('Pay via Browser / Web Checkout', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ],
                    const SizedBox(height: 14),

                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.05),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: Row(
                        children: const [
                          SizedBox(
                            width: 18, height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.gold),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              'Listening for bank confirmation...\nBalance auto-updates in ~3 seconds.',
                              style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),

                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: manualUtrCtrl,
                            keyboardType: TextInputType.number,
                            maxLength: 12,
                            decoration: const InputDecoration(
                              labelText: 'Bank SMS delayed? Enter 12-digit UTR',
                              hintText: 'e.g. 4289XXXXXXXX',
                              counterText: '',
                              isDense: true,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          onPressed: verifyingUtr ? null : () async {
                            final utr = manualUtrCtrl.text.trim();
                            if (utr.length != 12) {
                              _snack('UTR must be 12 digits', AppColors.red);
                              return;
                            }
                            setSheetState(() => verifyingUtr = true);
                            try {
                              final vRes = await widget.api.dio.post('/api/wallet/youpi/order/$orderId/verify-utr', data: {'utr': utr});
                              final vData = vRes.data is Map ? Map<String, dynamic>.from(vRes.data as Map) : <String, dynamic>{};
                              if (vData['status'] == 'SUCCESS') {
                                pollTimer?.cancel();
                                dialogClosed = true;
                                Navigator.pop(ctx);
                                if (mounted) {
                                  _snack('🎉 Payment verified and ₹${amount.toStringAsFixed(2)} credited! ⚡', AppColors.green);
                                  Navigator.pop(context, true);
                                }
                              } else {
                                _snack('UTR registered. Balance will credit shortly.', AppColors.green);
                              }
                            } catch (e) {
                              final err = e is DioException ? (e.response?.data?['error']?.toString() ?? 'UTR verification failed') : 'Failed';
                              _snack(err, AppColors.red);
                            } finally {
                              setSheetState(() => verifyingUtr = false);
                            }
                          },
                          child: verifyingUtr
                              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                              : const Text('Verify'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                  ],
                ),
              ),
            );
          },
        );
      },
    ).then((_) {
      dialogClosed = true;
      pollTimer?.cancel();
    });
  }

  Future<void> _load() async {
    try {
      final res = await widget.api.dio.get('/api/wallet/deposit/methods');
      setState(() {
        _methods = res.data as List;
        if (_methods.isNotEmpty)
          _selected = Map<String, dynamic>.from(_methods.first);
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _pickScreenshot() async {
    final img = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 70);
    if (img != null) setState(() => _screenshot = img);
  }

  void _snack(String msg, Color c) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(msg), backgroundColor: c));

  Future<void> _validatePromo() async {
    final code = _promoCtrl.text.trim().toUpperCase();
    if (code.isEmpty) return;
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 1) {
      _snack('Enter amount first', AppColors.orange);
      return;
    }
    setState(() => _validatingPromo = true);
    try {
      final res = await widget.api.dio.post('/api/wallet/promo/validate',
          data: {'code': code, 'amount': amount});
      final pData = res.data is Map ? Map<String, dynamic>.from(res.data as Map) : <String, dynamic>{};
      setState(() => _promoResult = pData);
      final discAmt = double.tryParse(pData['discount_amount']?.toString() ?? '0') ?? 0.0;
      _snack(
          'Promo applied! ₹${discAmt.toStringAsFixed(2)} bonus',
          AppColors.green);
    } catch (e) {
      setState(() => _promoResult = null);
      final msg = e is DioException
          ? (e.response?.data?['error']?.toString() ?? 'Invalid code')
          : 'Invalid code';
      _snack(msg, AppColors.red);
    } finally {
      if (mounted) setState(() => _validatingPromo = false);
    }
  }

  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 1) {
      _snack('Enter a valid amount', AppColors.red);
      return;
    }
    if (_refCtrl.text.trim().isEmpty) {
      _snack('Enter the UPI/UTR reference number', AppColors.red);
      return;
    }
    if (_screenshot == null) {
      _snack('Attach a payment screenshot', AppColors.red);
      return;
    }

    setState(() => _submitting = true);
    try {
      final form = FormData.fromMap({
        'amount': amount,
        if (_selected != null) 'payment_method_id': _selected!['id'],
        'reference_number': _refCtrl.text.trim(),
        'screenshot': await MultipartFile.fromFile(_screenshot!.path,
            filename: _screenshot!.name),
        if (_promoCtrl.text.trim().isNotEmpty)
          'promo_code': _promoCtrl.text.trim().toUpperCase(),
      });
      final res =
          await widget.api.dio.post('/api/wallet/deposit/submit', data: form);
      ProductAnalytics.instance.track('deposit_submitted', {'amount': amount});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      final msg = e is DioException
          ? (e.response?.data?['error']?.toString() ?? 'Submit failed')
          : 'Submit failed';
      _snack(msg, AppColors.red);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  // Build a standard UPI payment URI from the admin-configured VPA, embedding
  // the amount currently typed in so the payer's UPI app opens pre-filled.
  // Rendered as a QR (scanned, not launched as an app intent) because intent
  // links (upi://pay opened via launchUrl) get blocked by UPI apps' fraud
  // heuristics for collect requests to VPAs with no prior payer history —
  // a plain QR scan doesn't trip that check.
  String _upiUri(Map<String, dynamic> m) {
    final upiId = m['upi_id']?.toString() ?? '';
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    final payeeName = (m['account_name'] ?? m['label'] ?? 'Add Money').toString();
    final params = StringBuffer('pa=${Uri.encodeComponent(upiId)}'
        '&pn=${Uri.encodeComponent(payeeName)}'
        '&cu=INR'
        '&tn=${Uri.encodeComponent('Add Money')}');
    if (amount >= 1) params.write('&am=${amount.toStringAsFixed(2)}');
    return 'upi://pay?$params';
  }

  // Save the QR shown on screen to the device's gallery: the admin-uploaded
  // QR image when one is configured for this method, otherwise the
  // generated UPI QR.
  Future<void> _downloadQr(Map<String, dynamic> m) async {
    try {
      final hasAccess = await Gal.hasAccess();
      if (!hasAccess) {
        final granted = await Gal.requestAccess();
        if (!granted) {
          _snack('Gallery permission denied', AppColors.red);
          return;
        }
      }
      final qrImageUrl = m['qr_image_url']?.toString();
      if (qrImageUrl != null && qrImageUrl.isNotEmpty) {
        final res = await Dio().get<List<int>>(_resolveUrl(qrImageUrl),
            options: Options(responseType: ResponseType.bytes));
        await Gal.putImageBytes(Uint8List.fromList(res.data!),
            album: 'MyOnlineJoker');
      } else {
        final painter = QrPainter(
          data: _upiUri(m),
          version: QrVersions.auto,
          gapless: true,
        );
        final imageData = await painter.toImageData(600);
        if (imageData == null) throw Exception('No image data');
        await Gal.putImageBytes(imageData.buffer.asUint8List(),
            album: 'MyOnlineJoker');
      }
      _snack('QR code saved to gallery', AppColors.green);
    } catch (e) {
      _snack('Could not save QR code', AppColors.red);
    }
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(
              width: 110,
              child: Text(label,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13))),
          Expanded(
              child: Text(value,
                  style: const TextStyle(fontWeight: FontWeight.w600))),
          IconButton(
            icon: const Icon(Icons.copy, size: 16),
            onPressed: () {
              Clipboard.setData(ClipboardData(text: value));
              _snack('Copied', AppColors.green);
            },
          ),
        ],
      ),
    );
  }

  Widget _payStep(int n, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 18,
            height: 18,
            margin: const EdgeInsets.only(top: 1),
            decoration: const BoxDecoration(
                color: AppColors.gold, shape: BoxShape.circle),
            child: Center(
                child: Text('$n',
                    style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: Colors.black))),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 12)),
          ),
        ],
      ),
    );
  }

  Widget _methodDetails(Map<String, dynamic> m) {
    switch (m['method_type']) {
      case 'upi':
        final uploadedQrUrl = m['qr_image_url']?.toString();
        final hasUploadedQr = uploadedQrUrl != null && uploadedQrUrl.isNotEmpty;
        return Column(children: [
          Center(
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
              ),
              child: hasUploadedQr
                  ? Image.network(_resolveUrl(uploadedQrUrl),
                      height: 190,
                      width: 190,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => const SizedBox(
                          height: 190,
                          width: 190,
                          child: Center(child: Text('QR image unavailable'))))
                  : QrImageView(
                      data: _upiUri(m),
                      size: 190,
                      backgroundColor: Colors.white,
                    ),
            ),
          ),
          const SizedBox(height: 6),
          const Text('Scan with any UPI app',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 10),
          TextButton.icon(
            onPressed: () => _downloadQr(m),
            icon: const Icon(Icons.download, size: 16),
            label: const Text('Download QR Code'),
          ),
          const SizedBox(height: 4),
          _detailRow('UPI ID', m['upi_id']?.toString() ?? '-'),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: Text('How to pay',
                style: TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                    color: AppColors.textPrimary)),
          ),
          const SizedBox(height: 6),
          _payStep(
              1,
              hasUploadedQr
                  ? 'Enter the amount below.'
                  : 'Enter the amount below (the QR updates automatically).'),
          _payStep(2, 'Open any UPI app (PhonePe, GPay, Paytm) and scan the QR — or tap "Download QR Code" to save it to your gallery and scan later.'),
          _payStep(3, 'Complete the payment in your UPI app.'),
          _payStep(4, 'Copy the UPI reference/UTR number from your payment app.'),
          _payStep(5, 'Paste it below, attach a screenshot, and submit.'),
        ]);
      case 'bank':
        return Column(children: [
          if (m['account_name'] != null)
            _detailRow('Name', m['account_name'].toString()),
          _detailRow('A/c Number', m['account_number']?.toString() ?? '-'),
          _detailRow('IFSC', m['ifsc']?.toString() ?? '-'),
          if (m['bank_name'] != null)
            _detailRow('Bank', m['bank_name'].toString()),
        ]);
      case 'qr':
        return Center(
          child: m['qr_image_url'] != null
              ? Image.network(_resolveUrl(m['qr_image_url']?.toString()),
                  height: 200,
                  errorBuilder: (_, __, ___) =>
                      const Text('QR image unavailable'))
              : const Text('No QR configured'),
        );
      default:
        return const SizedBox.shrink();
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding:
          EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20 + bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Add Money',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 14),

            // Tab switch between ⚡ Instant Auto-UPI and 📸 Manual Deposit
            Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white10),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(9),
                      onTap: () => setState(() => _activeTab = 0),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        decoration: BoxDecoration(
                          color: _activeTab == 0 ? AppColors.gold : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          '⚡ Instant Auto-UPI',
                          style: TextStyle(
                            color: _activeTab == 0 ? Colors.black : Colors.white70,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: InkWell(
                      borderRadius: BorderRadius.circular(9),
                      onTap: () => setState(() => _activeTab = 1),
                      child: Container(
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        decoration: BoxDecoration(
                          color: _activeTab == 1 ? AppColors.gold : Colors.transparent,
                          borderRadius: BorderRadius.circular(9),
                        ),
                        alignment: Alignment.center,
                        child: Text(
                          '📸 Manual / QR',
                          style: TextStyle(
                            color: _activeTab == 1 ? Colors.black : Colors.white70,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),

            if (_activeTab == 0) ...[
              // ---- ⚡ INSTANT AUTO-UPI TAB ----
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      const Color(0xFF52C41A).withValues(alpha: 0.15),
                      Colors.transparent,
                    ],
                  ),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF52C41A).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: const [
                    Icon(Icons.bolt, color: Color(0xFF52C41A), size: 22),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        '0% Fees · NPCI Direct UPI Intent · Auto-credited to your wallet in ~3 seconds.',
                        style: TextStyle(fontSize: 12, color: Colors.white, height: 1.3),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              // Quick amount presets
              const Text('Select Amount', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _presetAmounts.map((amt) {
                  final sel = _amountCtrl.text == amt.toString();
                  return ChoiceChip(
                    label: Text('₹$amt', style: TextStyle(fontWeight: sel ? FontWeight.bold : FontWeight.normal)),
                    selected: sel,
                    onSelected: (_) {
                      setState(() {
                        _amountCtrl.text = amt.toString();
                        if (_promoResult != null) _promoResult = null;
                      });
                    },
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),

              TextField(
                controller: _amountCtrl,
                keyboardType: TextInputType.number,
                onChanged: (_) {
                  setState(() {
                    if (_promoResult != null) _promoResult = null;
                  });
                },
                decoration: const InputDecoration(
                  labelText: 'Amount (₹)',
                  prefixText: '₹ ',
                ),
              ),
              const SizedBox(height: 12),

              // Promo Code Row
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _promoCtrl,
                      textCapitalization: TextCapitalization.characters,
                      decoration: InputDecoration(
                        labelText: 'Promo Code (Optional)',
                        hintText: 'e.g. WELCOME50',
                        prefixIcon: const Icon(Icons.local_offer_outlined, size: 18),
                        suffixIcon: _promoResult != null
                            ? const Icon(Icons.check_circle, color: Color(0xFF00C853), size: 20)
                            : null,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  _validatingPromo
                      ? const SizedBox(width: 44, height: 44, child: CircularProgressIndicator(strokeWidth: 2))
                      : OutlinedButton(
                          onPressed: _validatePromo,
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(64, 50),
                            side: const BorderSide(color: AppColors.gold),
                          ),
                          child: const Text('Apply', style: TextStyle(color: AppColors.gold, fontSize: 13)),
                        ),
                ],
              ),
              if (_promoResult != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFF00C853).withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: const Color(0xFF00C853).withValues(alpha: 0.3)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.celebration_outlined, color: Color(0xFF00C853), size: 16),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          '${_promoResult!['code']} — ₹${(double.tryParse(_promoResult!['discount_amount']?.toString() ?? '0') ?? 0.0).toStringAsFixed(0)} bonus!',
                          style: const TextStyle(color: Color(0xFF00C853), fontSize: 12, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 20),

              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                  ),
                  onPressed: _youpiLoading ? null : _startInstantUpi,
                  icon: const Icon(Icons.bolt, size: 20),
                  label: _youpiLoading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                      : const Text('Pay with UPI (PhonePe / GPay / Paytm)', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                ),
              ),
              const SizedBox(height: 8),
              const Center(
                child: Text('Supports PhonePe, Google Pay, Paytm, BHIM & all Indian UPI apps',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 11)),
              ),
            ] else ...[
              // ---- 📸 MANUAL DEPOSIT TAB ----
              _loading
                  ? const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))
                  : _methods.isEmpty
                      ? const SizedBox(
                          height: 160,
                          child: Center(
                              child: Text(
                                  'No manual payment methods configured.\nPlease use Instant Auto-UPI above.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: AppColors.textSecondary))))
                      : Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Method selector
                            Wrap(
                              spacing: 8,
                              children: _methods.map((m) {
                                final sel = _selected?['id'] == m['id'];
                                return ChoiceChip(
                                  label: Text(m['label']?.toString() ??
                                      m['method_type'].toString().toUpperCase()),
                                  selected: sel,
                                  onSelected: (_) => setState(
                                      () => _selected = Map<String, dynamic>.from(m)),
                                );
                              }).toList(),
                            ),
                            const SizedBox(height: 16),

                            // Selected method payment details
                            if (_selected != null)
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: AppColors.cardBg,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(color: AppColors.border),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    const Text('Pay to:',
                                        style: TextStyle(
                                            color: AppColors.textSecondary,
                                            fontSize: 12)),
                                    const SizedBox(height: 6),
                                    _methodDetails(_selected!),
                                    if (_selected!['instructions'] != null) ...[
                                      const SizedBox(height: 8),
                                      Text(_selected!['instructions'].toString(),
                                          style: const TextStyle(
                                              color: AppColors.orange, fontSize: 12)),
                                    ],
                                  ],
                                ),
                              ),
                            const SizedBox(height: 16),

                            TextField(
                              controller: _amountCtrl,
                              keyboardType: TextInputType.number,
                              onChanged: (_) {
                                setState(() {
                                  if (_promoResult != null) _promoResult = null;
                                });
                              },
                              decoration: const InputDecoration(
                                  labelText: 'Amount (₹)', prefixText: '₹ '),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _refCtrl,
                              decoration: const InputDecoration(
                                  labelText: 'UPI / UTR Reference Number',
                                  hintText: 'e.g. 4012XXXXXX'),
                            ),
                            const SizedBox(height: 12),

                            OutlinedButton.icon(
                              onPressed: _pickScreenshot,
                              icon: const Icon(Icons.image),
                              label: Text(_screenshot == null
                                  ? 'Attach Payment Screenshot'
                                  : 'Screenshot attached ✓'),
                            ),
                            if (_screenshot != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 10),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.file(File(_screenshot!.path),
                                      height: 120,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, __, ___) =>
                                          const SizedBox.shrink()),
                                ),
                              ),
                            const SizedBox(height: 20),

                            SizedBox(
                              width: double.infinity,
                              child: ElevatedButton(
                                onPressed: _submitting ? null : _submit,
                                child: _submitting
                                    ? const SizedBox(
                                        height: 20,
                                        width: 20,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2, color: Colors.black))
                                    : const Text('Submit for Manual Approval'),
                              ),
                            ),
                          ],
                        ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---- Withdraw sheet: amount + payout UPI/bank ----
class _WithdrawSheet extends StatefulWidget {
  final ApiClient api;
  final String balance;
  const _WithdrawSheet({required this.api, required this.balance});
  @override
  State<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _amountCtrl = TextEditingController();
  bool _submitting = false;
  bool _loadingBank = true;
  Map<String, dynamic>? _bank;

  bool get _bankVerified => _bank != null && _bank!['verified'] == true;

  // Withdrawal window: 10 AM – 9 PM (device local time, UI-only gate).
  bool get _withdrawOpen {
    final h = DateTime.now().hour;
    return h >= 10 && h < 21;
  }

  @override
  void initState() {
    super.initState();
    _loadBank();
  }

  Future<void> _loadBank() async {
    try {
      final res = await widget.api.dio.get('/api/users/me/bank');
      if (mounted) setState(() => _bank = res.data['bank'] as Map<String, dynamic>?);
    } catch (_) {
      if (mounted) setState(() => _bank = null);
    } finally {
      if (mounted) setState(() => _loadingBank = false);
    }
  }

  String _maskAccount(String acc) {
    if (acc.length <= 4) return acc;
    return '•' * (acc.length - 4) + acc.substring(acc.length - 4);
  }

  void _snack(String msg, Color c) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text(msg), backgroundColor: c));

  void _showKycRequiredDialog() {
    showDialog(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Row(
          children: [
            Icon(Icons.verified_user_rounded,
                color: AppColors.orange, size: 22),
            SizedBox(width: 8),
            Expanded(
                child: Text('KYC Required for Withdrawal',
                    style: TextStyle(fontSize: 17))),
          ],
        ),
        content: const Text(
          'To withdraw money you must complete KYC verification first. '
          'Submit your documents and our team will verify them shortly.',
          style: TextStyle(
              color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx),
            child: const Text('Later',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () {
              final nav = Navigator.of(context, rootNavigator: true);
              Navigator.pop(dialogCtx); // close dialog
              Navigator.pop(context); // close withdraw sheet
              nav.push(MaterialPageRoute(builder: (_) => const KycPage()));
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.gold,
              foregroundColor: Colors.black,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
            child: const Text('Complete KYC',
                style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
  }

  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 100) {
      _snack('Minimum withdrawal is ₹100', AppColors.red);
      return;
    }
    if (!_bankVerified) {
      _snack('Add and verify your bank details before withdrawing', AppColors.red);
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.api.dio.post('/api/wallet/withdraw/request', data: {
        'amount': amount,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      final msg = e is DioException
          ? (e.response?.data?['error']?.toString() ?? 'Request failed')
          : 'Request failed';
      // KYC gate: server rejects withdrawals until KYC is approved — show a
      // clear dialog with a shortcut to complete KYC instead of a plain snack.
      if (e is DioException &&
          e.response?.statusCode == 403 &&
          msg.toLowerCase().contains('kyc')) {
        if (mounted) _showKycRequiredDialog();
      } else {
        _snack(msg, AppColors.red);
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding:
          EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Withdraw',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Available: ₹${widget.balance}',
              style: const TextStyle(color: AppColors.textSecondary)),
          if (!_withdrawOpen) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.orange.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
                border:
                    Border.all(color: AppColors.orange.withValues(alpha: 0.4)),
              ),
              child: const Row(children: [
                Icon(Icons.schedule, color: AppColors.orange, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                      'Withdrawals are open 10 AM to 9 PM. Please come back later.',
                      style:
                          TextStyle(color: AppColors.orange, fontSize: 12.5)),
                ),
              ]),
            ),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _amountCtrl,
            enabled: _bankVerified,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
                labelText: 'Amount (₹)',
                prefixText: '₹ ',
                helperText:
                    'Min ₹100 · KYC required · Withdrawals 10 AM – 9 PM'),
          ),
          const SizedBox(height: 16),
          if (_loadingBank)
            const Center(
                child: Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: CircularProgressIndicator(strokeWidth: 2),
            ))
          else if (_bank == null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.orange.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: AppColors.orange.withValues(alpha: 0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(children: [
                    Icon(Icons.account_balance_rounded,
                        color: AppColors.orange, size: 18),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text('Add your bank details to withdraw',
                          style: TextStyle(
                              color: AppColors.orange,
                              fontWeight: FontWeight.w700,
                              fontSize: 13)),
                    ),
                  ]),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        Navigator.of(context, rootNavigator: true).push(
                            MaterialPageRoute(
                                builder: (_) => const BankDetailsPage()));
                      },
                      child: const Text('Add Bank Details'),
                    ),
                  ),
                ],
              ),
            )
          else if (!_bankVerified)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.orange.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: AppColors.orange.withValues(alpha: 0.4)),
              ),
              child: const Row(children: [
                Icon(Icons.hourglass_top_rounded,
                    color: AppColors.orange, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                      'Your bank details are pending verification. You can withdraw once approved.',
                      style: TextStyle(color: AppColors.orange, fontSize: 12.5)),
                ),
              ]),
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(children: [
                    Icon(Icons.verified_rounded,
                        color: AppColors.green, size: 16),
                    SizedBox(width: 6),
                    Text('Payout account',
                        style: TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ]),
                  const SizedBox(height: 6),
                  Text(_bank!['holder_name']?.toString() ?? '',
                      style:
                          const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  Text(
                      '${_bank!['bank_name'] ?? ''} · ${_maskAccount(_bank!['account_number']?.toString() ?? '')}',
                      style: const TextStyle(fontSize: 12.5)),
                  Text(_bank!['ifsc_code']?.toString() ?? '',
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed:
                  (_submitting || !_withdrawOpen || !_bankVerified) ? null : _submit,
              child: _submitting
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.black))
                  : Text(_withdrawOpen
                      ? 'Request Withdrawal'
                      : 'Available 10 AM – 9 PM'),
            ),
          ),
        ],
      ),
    );
  }
}
