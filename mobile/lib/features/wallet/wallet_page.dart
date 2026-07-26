import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:hive/hive.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:gal/gal.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../../core/services/balance_service.dart';
import '../../core/analytics/product_analytics.dart';
import '../../shared/theme/app_theme.dart';
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

  @override
  Widget build(BuildContext context) {
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
                    '₹${((double.tryParse(_realBalance) ?? 0) + (double.tryParse(_bonusBalance) ?? 0)).toStringAsFixed(2)}',
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
                            Text('₹$_realBalance',
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
                            Text('₹$_bonusBalance',
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
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _openDeposit,
                    icon: const Icon(Icons.add),
                    label: const Text('Add Money'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _openWithdraw,
                    icon: const Icon(Icons.account_balance),
                    label: const Text('Withdraw'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),

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
      setState(() => _promoResult = res.data as Map<String, dynamic>);
      _snack(
          'Promo applied! ₹${(_promoResult!['discount_amount'] as num).toStringAsFixed(2)} bonus',
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
      child: _loading
          ? const SizedBox(
              height: 200, child: Center(child: CircularProgressIndicator()))
          : _methods.isEmpty
              ? const SizedBox(
                  height: 160,
                  child: Center(
                      child: Text(
                          'No payment methods available.\nPlease contact support.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: AppColors.textSecondary))))
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Add Money',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),

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

                      // Promo Code
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _promoCtrl,
                              textCapitalization: TextCapitalization.characters,
                              decoration: InputDecoration(
                                labelText: 'Promo Code (Optional)',
                                hintText: 'e.g. WELCOME50',
                                prefixIcon: const Icon(
                                    Icons.local_offer_outlined,
                                    size: 18),
                                suffixIcon: _promoResult != null
                                    ? const Icon(Icons.check_circle,
                                        color: Color(0xFF00C853), size: 20)
                                    : null,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          _validatingPromo
                              ? const SizedBox(
                                  width: 44,
                                  height: 44,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : OutlinedButton(
                                  onPressed: _validatePromo,
                                  style: OutlinedButton.styleFrom(
                                    minimumSize: const Size(64, 50),
                                    side:
                                        const BorderSide(color: AppColors.gold),
                                  ),
                                  child: const Text('Apply',
                                      style: TextStyle(
                                          color: AppColors.gold, fontSize: 13)),
                                ),
                        ],
                      ),
                      if (_promoResult != null) ...[
                        const SizedBox(height: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color:
                                const Color(0xFF00C853).withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                                color: const Color(0xFF00C853)
                                    .withValues(alpha: 0.3)),
                          ),
                          child: Row(
                            children: [
                              const Icon(Icons.celebration_outlined,
                                  color: Color(0xFF00C853), size: 16),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  '${_promoResult!['code']} — ₹${(_promoResult!['discount_amount'] as num).toStringAsFixed(0)} bonus on approval!',
                                  style: const TextStyle(
                                      color: Color(0xFF00C853),
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
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
                              : const Text('Submit for Approval'),
                        ),
                      ),
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
