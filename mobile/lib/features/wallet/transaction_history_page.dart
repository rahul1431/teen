import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

class TransactionHistoryPage extends StatefulWidget {
  const TransactionHistoryPage({super.key});
  @override
  State<TransactionHistoryPage> createState() => _TransactionHistoryPageState();
}

class _TransactionHistoryPageState extends State<TransactionHistoryPage> {
  final _api = ApiClient();
  List<dynamic> _transactions = [];
  bool _loading = true;
  bool _hasError = false;
  String _filter = 'all';

  static const _filters = {
    'all': 'All',
    'credit': 'Credits',
    'debit': 'Debits',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _hasError = false; });
    try {
      final res = await _api.dio.get('/api/wallet/transactions?limit=100');
      if (!mounted) return;
      setState(() { _transactions = res.data as List? ?? []; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _hasError = true; });
    }
  }

  bool _isCredit(String type) =>
      type.contains('credit') || type == 'deposit' || type == 'bonus' || type == 'referral';

  List<dynamic> get _visible {
    if (_filter == 'all') return _transactions;
    return _transactions.where((t) {
      final credit = _isCredit(t['type'].toString());
      return _filter == 'credit' ? credit : !credit;
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Transaction History')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: _filters.entries.map((e) {
                final selected = _filter == e.key;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(e.value),
                    selected: selected,
                    onSelected: (_) => setState(() => _filter = e.key),
                    selectedColor: AppColors.gold.withOpacity(0.2),
                    backgroundColor: AppColors.surface,
                    labelStyle: TextStyle(
                      color: selected ? AppColors.gold : AppColors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                    side: BorderSide(color: selected ? AppColors.gold : AppColors.border),
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_hasError) {
      return Center(child: ErrorRetry(message: 'Could not load transactions', onRetry: _load));
    }
    final txns = _visible;
    if (txns.isEmpty) {
      return const Center(
        child: Text('No transactions yet',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      backgroundColor: AppColors.surface,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        itemCount: txns.length,
        itemBuilder: (_, i) {
          final txn = txns[i];
          final type = txn['type'].toString();
          final credit = _isCredit(type);
          final color = credit ? AppColors.green : AppColors.red;
          return Container(
            margin: const EdgeInsets.only(bottom: 8),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: color.withOpacity(0.15),
                child: Icon(credit ? Icons.add : Icons.remove, color: color),
              ),
              title: Text(type.replaceAll('_', ' ').toUpperCase(),
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              subtitle: Text(
                DateTime.parse(txn['created_at']).toLocal().toString().substring(0, 16),
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
              ),
              trailing: Text(
                '${credit ? '+' : '-'}₹${double.parse(txn['amount'].toString()).toStringAsFixed(2)}',
                style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 14),
              ),
            ),
          );
        },
      ),
    );
  }
}
