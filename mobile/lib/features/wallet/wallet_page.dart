import 'package:flutter/material.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../../shared/theme/app_theme.dart';

class WalletPage extends StatefulWidget {
  const WalletPage({super.key});
  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  final _api = ApiClient();
  late final Razorpay _razorpay;
  String _realBalance = '0.00';
  String _bonusBalance = '0.00';
  List<dynamic> _transactions = [];
  bool _loading = false;
  int _depositAmount = 100;

  @override
  void initState() {
    super.initState();
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
    _loadData();
  }

  @override
  void dispose() {
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final [balRes, txnRes] = await Future.wait([
        _api.dio.get('/api/wallet/balance'),
        _api.dio.get('/api/wallet/transactions?limit=20'),
      ]);
      setState(() {
        _realBalance = double.parse(balRes.data['real_balance'].toString()).toStringAsFixed(2);
        _bonusBalance = double.parse(balRes.data['bonus_balance'].toString()).toStringAsFixed(2);
        _transactions = txnRes.data;
      });
    } catch (_) {}
  }

  Future<void> _startDeposit() async {
    setState(() => _loading = true);
    try {
      final res = await _api.dio.post('/api/wallet/deposit/create-order', data: {'amount': _depositAmount});
      final options = {
        'key': AppConfig.razorpayKeyId,
        'amount': _depositAmount * 100,
        'name': 'MyOnlineJoker',
        'description': 'Add Money to Wallet',
        'order_id': res.data['order_id'],
        'prefill': {'contact': '', 'email': ''},
        'theme': {'color': '#D4AF37'},
      };
      _razorpay.open(options);
    } catch (e) {
      _showError('Failed to initiate payment');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _handlePaymentSuccess(PaymentSuccessResponse response) async {
    try {
      await _api.dio.post('/api/wallet/deposit/verify', data: {
        'razorpay_order_id': response.orderId,
        'razorpay_payment_id': response.paymentId,
        'razorpay_signature': response.signature,
      });
      _showSuccess('₹$_depositAmount added to your wallet!');
      _loadData();
    } catch (_) {
      _showError('Payment verification failed. Contact support.');
    }
  }

  void _handlePaymentError(PaymentFailureResponse response) => _showError('Payment failed: ${response.message}');

  void _showError(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: AppColors.red));
  void _showSuccess(String msg) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: AppColors.green));

  Color _txnColor(String type) {
    if (type.contains('credit') || type == 'deposit' || type == 'game_credit' || type == 'bonus' || type == 'referral') return AppColors.green;
    return AppColors.red;
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
                gradient: const LinearGradient(colors: [Color(0xFF1A2035), Color(0xFF0D1117)]),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: AppColors.gold.withOpacity(0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Available Balance', style: TextStyle(color: AppColors.textSecondary)),
                  Text('₹$_realBalance', style: const TextStyle(fontSize: 36, fontWeight: FontWeight.bold, color: AppColors.gold)),
                  const SizedBox(height: 8),
                  Text('Bonus: ₹$_bonusBalance', style: const TextStyle(color: Colors.orange)),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Add money
            const Text('Add Money', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 12, runSpacing: 12,
              children: [100, 200, 500, 1000, 2000, 5000].map((amt) {
                final sel = _depositAmount == amt;
                return GestureDetector(
                  onTap: () => setState(() => _depositAmount = amt),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    decoration: BoxDecoration(
                      color: sel ? AppColors.gold : AppColors.cardBg,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: sel ? AppColors.gold : AppColors.border),
                    ),
                    child: Text('₹$amt', style: TextStyle(color: sel ? Colors.black : AppColors.textPrimary, fontWeight: FontWeight.bold)),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _loading ? null : _startDeposit,
                child: _loading ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : Text('Add ₹$_depositAmount'),
              ),
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
