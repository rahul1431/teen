import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import 'package:image_picker/image_picker.dart';
import 'package:hive/hive.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../../shared/theme/app_theme.dart';

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
      final real = double.parse(balRes.data['real_balance'].toString()).toStringAsFixed(2);
      final bonus = double.parse(balRes.data['bonus_balance'].toString()).toStringAsFixed(2);
      setState(() {
        _realBalance = real;
        _bonusBalance = bonus;
        _transactions = txnRes.data;
      });
      try {
        final box = Hive.box('wallet');
        box.put('real_balance', real);
        box.put('bonus_balance', bonus);
      } catch (_) {}
    } catch (_) {
      if (mounted) AppSnackBar.show(context, 'Could not load wallet data', error: true);
    }
  }

  void _showError(String msg) => AppSnackBar.show(context, msg, error: true);
  void _showSuccess(String msg) => AppSnackBar.show(context, msg, success: true);

  Color _txnColor(String type) {
    if (type.contains('credit') || type == 'deposit' || type == 'game_credit' || type == 'bonus' || type == 'referral') return AppColors.green;
    return AppColors.red;
  }

  Future<void> _openDeposit() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _DepositSheet(api: _api),
    );
    if (ok == true) {
      _showSuccess('Deposit submitted for review. Balance updates after admin approval.');
      _loadData();
    }
  }

  Future<void> _openWithdraw() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
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
      appBar: AppBar(title: const Text('Wallet')),
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Balance card
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [AppColors.cardBg, AppColors.surface]),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Available Balance', style: TextStyle(color: AppColors.textSecondary)),
                  Text('₹$_realBalance', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: AppColors.gold)),
                  const SizedBox(height: 8),
                  Text('Bonus: ₹$_bonusBalance', style: const TextStyle(color: AppColors.orange)),
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
            const Text('Recent Transactions', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (_transactions.isEmpty)
              const Center(child: Text('No transactions yet', style: TextStyle(color: AppColors.textSecondary)))
            else
              ..._transactions.map((txn) => ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 0, vertical: 4),
                leading: CircleAvatar(
                  backgroundColor: _txnColor(txn['type']).withOpacity(0.15),
                  child: Icon(txn['type'].contains('credit') || txn['type'] == 'deposit' ? Icons.add : Icons.remove, color: _txnColor(txn['type'])),
                ),
                title: Text(txn['type'].toString().replaceAll('_', ' ').toUpperCase(), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                subtitle: Text(DateTime.parse(txn['created_at']).toLocal().toString().substring(0, 16)),
                trailing: Text(
                  '${_txnColor(txn['type']) == AppColors.green ? '+' : '-'}₹${double.parse(txn['amount'].toString()).toStringAsFixed(2)}',
                  style: TextStyle(color: _txnColor(txn['type']), fontWeight: FontWeight.bold),
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
  XFile? _screenshot;

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
        if (_methods.isNotEmpty) _selected = Map<String, dynamic>.from(_methods.first);
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _pickScreenshot() async {
    final img = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 70);
    if (img != null) setState(() => _screenshot = img);
  }

  void _snack(String msg, Color c) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: c));

  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 1) { _snack('Enter a valid amount', AppColors.red); return; }
    if (_refCtrl.text.trim().isEmpty) { _snack('Enter the UPI/UTR reference number', AppColors.red); return; }
    if (_screenshot == null) { _snack('Attach a payment screenshot', AppColors.red); return; }

    setState(() => _submitting = true);
    try {
      final form = FormData.fromMap({
        'amount': amount,
        if (_selected != null) 'payment_method_id': _selected!['id'],
        'reference_number': _refCtrl.text.trim(),
        'screenshot': await MultipartFile.fromFile(_screenshot!.path, filename: _screenshot!.name),
      });
      await widget.api.dio.post('/api/wallet/deposit/submit', data: form);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      final msg = e is DioException ? (e.response?.data?['error']?.toString() ?? 'Submit failed') : 'Submit failed';
      _snack(msg, AppColors.red);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Widget _detailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          SizedBox(width: 110, child: Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13))),
          Expanded(child: Text(value, style: const TextStyle(fontWeight: FontWeight.w600))),
          IconButton(
            icon: const Icon(Icons.copy, size: 16),
            onPressed: () { Clipboard.setData(ClipboardData(text: value)); _snack('Copied', AppColors.green); },
          ),
        ],
      ),
    );
  }

  Widget _methodDetails(Map<String, dynamic> m) {
    switch (m['method_type']) {
      case 'upi':
        return Column(children: [
          _detailRow('UPI ID', m['upi_id']?.toString() ?? '-'),
          if (m['qr_image_url'] != null) ...[
            const SizedBox(height: 8),
            const Text('Scan to pay:', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
            const SizedBox(height: 6),
            Image.network(_resolveUrl(m['qr_image_url']?.toString()), height: 180,
                errorBuilder: (_, __, ___) => const SizedBox.shrink()),
          ],
        ]);
      case 'bank':
        return Column(children: [
          if (m['account_name'] != null) _detailRow('Name', m['account_name'].toString()),
          _detailRow('A/c Number', m['account_number']?.toString() ?? '-'),
          _detailRow('IFSC', m['ifsc']?.toString() ?? '-'),
          if (m['bank_name'] != null) _detailRow('Bank', m['bank_name'].toString()),
        ]);
      case 'qr':
        return Center(
          child: m['qr_image_url'] != null
              ? Image.network(_resolveUrl(m['qr_image_url']?.toString()), height: 200,
                  errorBuilder: (_, __, ___) => const Text('QR image unavailable'))
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
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20 + bottom),
      child: _loading
          ? const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()))
          : _methods.isEmpty
              ? const SizedBox(height: 160, child: Center(child: Text('No payment methods available.\nPlease contact support.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary))))
              : SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Add Money', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 16),

                      // Method selector
                      Wrap(
                        spacing: 8,
                        children: _methods.map((m) {
                          final sel = _selected?['id'] == m['id'];
                          return ChoiceChip(
                            label: Text(m['label']?.toString() ?? m['method_type'].toString().toUpperCase()),
                            selected: sel,
                            onSelected: (_) => setState(() => _selected = Map<String, dynamic>.from(m)),
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
                              const Text('Pay to:', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              const SizedBox(height: 6),
                              _methodDetails(_selected!),
                              if (_selected!['instructions'] != null) ...[
                                const SizedBox(height: 8),
                                Text(_selected!['instructions'].toString(), style: const TextStyle(color: AppColors.orange, fontSize: 12)),
                              ],
                            ],
                          ),
                        ),
                      const SizedBox(height: 16),

                      TextField(
                        controller: _amountCtrl,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ '),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _refCtrl,
                        decoration: const InputDecoration(labelText: 'UPI / UTR Reference Number', hintText: 'e.g. 4012XXXXXX'),
                      ),
                      const SizedBox(height: 12),

                      OutlinedButton.icon(
                        onPressed: _pickScreenshot,
                        icon: const Icon(Icons.image),
                        label: Text(_screenshot == null ? 'Attach Payment Screenshot' : 'Screenshot attached ✓'),
                      ),
                      if (_screenshot != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 10),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.file(File(_screenshot!.path), height: 120, fit: BoxFit.cover,
                              errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                          ),
                        ),
                      const SizedBox(height: 20),

                      SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          onPressed: _submitting ? null : _submit,
                          child: _submitting
                              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
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
  final _upiCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  bool _submitting = false;

  void _snack(String msg, Color c) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: c));

  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 100) { _snack('Minimum withdrawal is ₹100', AppColors.red); return; }
    if (_upiCtrl.text.trim().isEmpty && _bankCtrl.text.trim().isEmpty) {
      _snack('Enter your UPI ID or bank account', AppColors.red); return;
    }
    setState(() => _submitting = true);
    try {
      await widget.api.dio.post('/api/wallet/withdraw/request', data: {
        'amount': amount,
        if (_upiCtrl.text.trim().isNotEmpty) 'upi_id': _upiCtrl.text.trim(),
        if (_bankCtrl.text.trim().isNotEmpty) 'bank_account': _bankCtrl.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      final msg = e is DioException ? (e.response?.data?['error']?.toString() ?? 'Request failed') : 'Request failed';
      _snack(msg, AppColors.red);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Withdraw', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          Text('Available: ₹${widget.balance}', style: const TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          TextField(
            controller: _amountCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ ', helperText: 'Min ₹100. KYC must be approved.'),
          ),
          const SizedBox(height: 12),
          TextField(controller: _upiCtrl, decoration: const InputDecoration(labelText: 'Your UPI ID (optional)', hintText: 'name@bank')),
          const SizedBox(height: 12),
          TextField(controller: _bankCtrl, decoration: const InputDecoration(labelText: 'Your Bank A/c + IFSC (optional)', hintText: 'A/c · IFSC')),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Text('Request Withdrawal'),
            ),
          ),
        ],
      ),
    );
  }
}
