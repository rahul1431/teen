import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:dio/dio.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/theme/app_theme.dart';

class ColorPredictionPage extends StatefulWidget {
  const ColorPredictionPage({super.key});

  @override
  State<ColorPredictionPage> createState() => _ColorPredictionPageState();
}

class _ColorPredictionPageState extends State<ColorPredictionPage>
    with SingleTickerProviderStateMixin {
  final Dio _dio = ApiClient().dio;
  late TabController _tabController;
  Timer? _pollerTimer;
  Timer? _countdownTimer;

  Map<String, dynamic>? _currentRound;
  List<dynamic> _history = [];
  List<dynamic> _myBets = [];

  String _selectedMode = '30s'; // '30s' | '1m' | '3m' | '5m'
  double _walletBalance = 0.0;
  int _remainingSeconds = 30;
  bool _isLocked = false;
  bool _isLoading = true;
  bool _isSubmittingBet = false;
  final Set<String> _notifiedBetIds = {};

  int _getMaxSecondsForMode(String mode) {
    switch (mode) {
      case '1m': return 60;
      case '3m': return 180;
      case '5m': return 300;
      default: return 30;
    }
  }

  String _formatTimer(int totalSeconds) {
    final mm = (totalSeconds ~/ 60).toString().padLeft(2, '0');
    final ss = (totalSeconds % 60).toString().padLeft(2, '0');
    return '$mm:$ss';
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _fetchData();
    _fetchWalletBalance();

    // 1-second countdown pulse
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) {
        setState(() {
          if (_remainingSeconds > 0) {
            _remainingSeconds--;
          }
          _isLocked = _remainingSeconds <= 5;
        });

        if (_remainingSeconds == 0) {
          _fetchData();
        }
      }
    });

    // 3-second sync poller
    _pollerTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) {
        _fetchData();
      }
    });
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _pollerTimer?.cancel();
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _fetchWalletBalance() async {
    try {
      final res = await _dio.get('/api/wallet/balance');
      if (res.data != null && mounted) {
        final bal = double.tryParse(res.data['real_balance']?.toString() ?? '') ??
            double.tryParse(res.data['balance']?.toString() ?? '') ??
            0.0;
        setState(() {
          _walletBalance = bal;
        });
      }
    } catch (_) {}
  }

  Future<void> _fetchData() async {
    try {
      final res = await _dio.get('/api/betting/color-prediction/current-round', queryParameters: {
        'game_mode': _selectedMode,
      });
      if (res.data != null && mounted) {
        final round = res.data['round'] as Map<String, dynamic>?;
        final history = (res.data['history'] as List<dynamic>?) ?? [];

        setState(() {
          _currentRound = round;
          _history = history;
          if (round != null) {
            final defaultSec = _getMaxSecondsForMode(_selectedMode);
            final serverSec = int.tryParse(round['remaining_seconds']?.toString() ?? '') ?? defaultSec;
            _remainingSeconds = serverSec;
            _isLocked = round['is_locked'] == true || _remainingSeconds <= 5;
          }
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }

    _fetchMyBets();
  }

  bool _isFirstBetsFetch = true;

  Future<void> _fetchMyBets() async {
    try {
      final res = await _dio.get('/api/betting/color-prediction/my-bets', queryParameters: {
        'game_mode': _selectedMode,
      });
      if (res.data != null && mounted) {
        final bets = (res.data['bets'] as List<dynamic>?) ?? [];
        setState(() {
          _myBets = bets;
        });

        if (_isFirstBetsFetch) {
          _isFirstBetsFetch = false;
          for (final b in bets) {
            final id = b['id']?.toString() ?? '';
            if (id.isNotEmpty) _notifiedBetIds.add(id);
          }
        } else {
          // Check for newly settled bets to display outcome alert
          for (final b in bets) {
            final id = b['id']?.toString() ?? '';
            final status = b['status']?.toString().toLowerCase() ?? '';
            if ((status == 'won' || status == 'lost') && !_notifiedBetIds.contains(id)) {
              _notifiedBetIds.add(id);
              _showResultModal(Map<String, dynamic>.from(b));
              _fetchWalletBalance();
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  void _showResultModal(Map<String, dynamic> bet) {
    if (!mounted) return;
    final isWon = bet['status']?.toString().toLowerCase() == 'won';
    final payout = double.tryParse(bet['payout']?.toString() ?? '') ?? 0.0;
    final amount = double.tryParse(bet['amount']?.toString() ?? '') ?? 0.0;
    final betVal = bet['bet_value']?.toString().toUpperCase() ?? '';
    final winNum = bet['winning_number'] ?? 0;
    final period = bet['period_id']?.toString() ?? '';

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E232F),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: isWon ? const Color(0xFF10B981) : const Color(0xFFEF4444), width: 1.5),
        ),
        title: Row(
          children: [
            Icon(
              isWon ? Icons.emoji_events : Icons.cancel,
              color: isWon ? Colors.amber : const Color(0xFFEF4444),
              size: 28,
            ),
            const SizedBox(width: 8),
            Text(
              isWon ? '🎉 YOU WON!' : '❌ BET LOST',
              style: TextStyle(
                color: isWon ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                fontWeight: FontWeight.w900,
                fontSize: 18,
              ),
            ),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Period: $period', style: const TextStyle(color: Colors.white54, fontSize: 12, fontFamily: 'monospace')),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Winning Number:', style: TextStyle(color: Colors.white70, fontSize: 13)),
                _buildColorBall(winNum, size: 32, fontSize: 14),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Your Selection:', style: TextStyle(color: Colors.white70, fontSize: 13)),
                Text(betVal, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
              ],
            ),
            const Divider(color: Color(0xFF2E384D), height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(isWon ? 'Prize Credited:' : 'Staked Amount:', style: const TextStyle(color: Colors.white70, fontSize: 13)),
                Text(
                  isWon ? '+₹${payout.toStringAsFixed(2)}' : '-₹${amount.toStringAsFixed(0)}',
                  style: TextStyle(
                    color: isWon ? const Color(0xFF10B981) : const Color(0xFFEF4444),
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                  ),
                ),
              ],
            ),
          ],
        ),
        actions: [
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx),
            style: ElevatedButton.styleFrom(
              backgroundColor: isWon ? const Color(0xFF10B981) : const Color(0xFF2A344A),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('CONTINUE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _openBetModal({
    required String betType,
    required String betValue,
    required String title,
    required Color accentColor,
    required double multiplier,
  }) {
    if (_isLocked) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('🔒 Betting is locked for this round. Please wait for the next period!'),
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    HapticFeedback.mediumImpact();
    int baseChip = 10;
    int multiplierVal = 1;

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E232F),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            final totalStake = baseChip * multiplierVal;
            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 20,
                bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Modal Header
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: accentColor.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: accentColor),
                            ),
                            child: Text(
                              title,
                              style: TextStyle(
                                color: accentColor,
                                fontWeight: FontWeight.w900,
                                fontSize: 16,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            '(${multiplier.toStringAsFixed(1)}x)',
                            style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.bold),
                          ),
                        ],
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white70),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Chip Presets
                  const Text('Select Stake Amount (₹):', style: TextStyle(color: Colors.white70, fontSize: 13)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [10, 50, 100, 500, 1000, 5000].map((chip) {
                      final isSel = baseChip == chip;
                      return GestureDetector(
                        onTap: () {
                          setModalState(() => baseChip = chip);
                          HapticFeedback.selectionClick();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          decoration: BoxDecoration(
                            color: isSel ? accentColor : const Color(0xFF2A3142),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: isSel ? Colors.white : Colors.transparent),
                          ),
                          child: Text(
                            '₹$chip',
                            style: TextStyle(
                              color: isSel ? Colors.white : Colors.white70,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 16),

                  // Multiplier Stepper
                  const Text('Multiplier Quantity:', style: TextStyle(color: Colors.white70, fontSize: 13)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: [1, 2, 5, 10, 20, 50].map((m) {
                      final isSel = multiplierVal == m;
                      return GestureDetector(
                        onTap: () {
                          setModalState(() => multiplierVal = m);
                          HapticFeedback.selectionClick();
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                          decoration: BoxDecoration(
                            color: isSel ? Colors.amber : const Color(0xFF2A3142),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'X$m',
                            style: TextStyle(
                              color: isSel ? Colors.black : Colors.white70,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),

                  // Total & Submit
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Total Stake:', style: TextStyle(color: Colors.white54, fontSize: 12)),
                          Text(
                            '₹$totalStake.00',
                            style: const TextStyle(
                              color: Color(0xFF10B981),
                              fontSize: 22,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                      ElevatedButton(
                        onPressed: _isSubmittingBet
                            ? null
                            : () async {
                                Navigator.pop(ctx);
                                await _placeBet(
                                  betType: betType,
                                  betValue: betValue,
                                  amount: totalStake.toDouble(),
                                );
                              },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: accentColor,
                          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 14),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                        ),
                        child: const Text(
                          'CONFIRM BET',
                          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _placeBet({
    required String betType,
    required String betValue,
    required double amount,
  }) async {
    if (amount > _walletBalance) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('⚠️ Insufficient wallet balance. Please add cash to proceed!'),
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    setState(() => _isSubmittingBet = true);
    try {
      final res = await _dio.post('/api/betting/color-prediction/bet', data: {
        'game_mode': _selectedMode,
        'bet_type': betType,
        'bet_value': betValue,
        'amount': amount,
      });

      if (res.data != null && res.data['success'] == true) {
        HapticFeedback.heavyImpact();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('✅ Bet placed successfully on ${betValue.toUpperCase()} (₹${amount.toStringAsFixed(0)})!'),
              backgroundColor: const Color(0xFF10B981),
            ),
          );
          // Switch to My Bets tab so user immediately sees their active bet
          _tabController.animateTo(2);
        }
        _fetchWalletBalance();
        _fetchMyBets();
      }
    } on DioException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.response?.data?['error']?.toString() ?? 'Failed to place bet. Please try again.'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to place bet. Please check network connection.'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmittingBet = false);
    }
  }

  Widget _buildColorBall(dynamic numVal, {double size = 32, double fontSize = 14}) {
    final num = int.tryParse(numVal.toString()) ?? 0;
    if (num == 0) {
      return Container(
        width: size,
        height: size,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF7C3AED), Color(0xFFEF4444)],
          ),
          boxShadow: [BoxShadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 2))],
        ),
        alignment: Alignment.center,
        child: Text('0', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: fontSize)),
      );
    }
    if (num == 5) {
      return Container(
        width: size,
        height: size,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF7C3AED), Color(0xFF10B981)],
          ),
          boxShadow: [BoxShadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 2))],
        ),
        alignment: Alignment.center,
        child: Text('5', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: fontSize)),
      );
    }

    final isGreen = const [1, 3, 7, 9].contains(num);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isGreen ? const Color(0xFF10B981) : const Color(0xFFEF4444),
        boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 4, offset: Offset(0, 2))],
      ),
      alignment: Alignment.center,
      child: Text('$num', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: fontSize)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final periodId = _currentRound?['period_id']?.toString() ?? 'Loading...';

    // Find active pending bet for current period
    final activeBet = _myBets.firstWhere(
      (b) => b['period_id']?.toString() == periodId && b['status']?.toString().toLowerCase() == 'pending',
      orElse: () => null,
    );

    final maxSec = _getMaxSecondsForMode(_selectedMode);

    return Scaffold(
      backgroundColor: const Color(0xFF0F141F),
      appBar: AppBar(
        backgroundColor: const Color(0xFF171D2B),
        elevation: 0,
        title: Row(
          children: [
            const Text('🎨 WinGo Color', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(color: const Color(0xFF10B981).withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
              child: Text(
                _selectedMode == '30s' ? '30s Fast' : _selectedMode.toUpperCase(),
                style: const TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.w900),
              ),
            ),
          ],
        ),
        actions: [
          // Wallet Balance Chip
          GestureBarChip(
            balance: _walletBalance,
            onRefresh: _fetchWalletBalance,
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF10B981)))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  // 0. Game Mode Selector Tabs (30s, 1M, 3M, 5M)
                  _buildModeSelector(),

                  // 1. Timer & Period Banner
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF1F293D), Color(0xFF161E2E)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFF2F3B52)),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withOpacity(0.3), blurRadius: 10, offset: const Offset(0, 4)),
                      ],
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('CURRENT PERIOD', style: TextStyle(color: Colors.white54, fontSize: 11, letterSpacing: 1)),
                                const SizedBox(height: 2),
                                Text(
                                  periodId,
                                  style: const TextStyle(color: Colors.amber, fontWeight: FontWeight.w900, fontSize: 17, fontFamily: 'monospace'),
                                ),
                              ],
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              decoration: BoxDecoration(
                                color: _isLocked ? Colors.redAccent.withOpacity(0.2) : const Color(0xFF10B981).withOpacity(0.2),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: _isLocked ? Colors.redAccent : const Color(0xFF10B981)),
                              ),
                              child: Text(
                                _isLocked ? '🔒 LOCKED' : '🟢 BETTING OPEN',
                                style: TextStyle(
                                  color: _isLocked ? Colors.redAccent : const Color(0xFF10B981),
                                  fontWeight: FontWeight.w900,
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 14),

                        // Countdown Timer Clock
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              _formatTimer(_remainingSeconds),
                              style: TextStyle(
                                color: _isLocked ? const Color(0xFFEF4444) : const Color(0xFF10B981),
                                fontSize: 44,
                                fontWeight: FontWeight.w900,
                                fontFamily: 'monospace',
                                letterSpacing: 2,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(6),
                          child: LinearProgressIndicator(
                            value: (_remainingSeconds / maxSec).clamp(0.0, 1.0),
                            backgroundColor: const Color(0xFF2A344A),
                            valueColor: AlwaysStoppedAnimation<Color>(
                              _isLocked ? const Color(0xFFEF4444) : const Color(0xFF10B981),
                            ),
                            minHeight: 6,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Active Bet Notification Box
                  if (activeBet != null) ...[
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Color(0xFF1E3A8A), Color(0xFF172554)]),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF3B82F6)),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.stars, color: Colors.amber, size: 22),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('YOUR ACTIVE BET (THIS PERIOD):', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.w900, fontSize: 11)),
                                Text(
                                  '${activeBet['bet_type']?.toString().toUpperCase()}: ${activeBet['bet_value']?.toString().toUpperCase()}  •  ₹${activeBet['amount']}',
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
                            child: const Text('DRAWING', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.w900, fontSize: 10)),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                  ],
                  const SizedBox(height: 6),

                  // 2. Color Selection Buttons (Green, Violet, Red)
                  Row(
                    children: [
                      Expanded(
                        child: _buildColorCard(
                          title: 'Green',
                          multiplier: '2x',
                          color: const Color(0xFF10B981),
                          onTap: () => _openBetModal(
                            betType: 'color',
                            betValue: 'green',
                            title: 'Join Green',
                            accentColor: const Color(0xFF10B981),
                            multiplier: 2.0,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildColorCard(
                          title: 'Violet',
                          multiplier: '4.5x',
                          color: const Color(0xFF7C3AED),
                          onTap: () => _openBetModal(
                            betType: 'color',
                            betValue: 'violet',
                            title: 'Join Violet',
                            accentColor: const Color(0xFF7C3AED),
                            multiplier: 4.5,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _buildColorCard(
                          title: 'Red',
                          multiplier: '2x',
                          color: const Color(0xFFEF4444),
                          onTap: () => _openBetModal(
                            betType: 'color',
                            betValue: 'red',
                            title: 'Join Red',
                            accentColor: const Color(0xFFEF4444),
                            multiplier: 2.0,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // 3. Numbers Grid (0 through 9)
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1A2130),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: const Color(0xFF2B364D)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text('SELECT NUMBER', style: TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 13)),
                            Text('9x Multiplier', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.w900, fontSize: 13)),
                          ],
                        ),
                        const SizedBox(height: 10),
                        GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 5,
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                            childAspectRatio: 1.1,
                          ),
                          itemCount: 10,
                          itemBuilder: (_, i) {
                            return GestureDetector(
                              onTap: () => _openBetModal(
                                betType: 'number',
                                betValue: '$i',
                                title: 'Number $i',
                                accentColor: i == 0 || i == 5 ? const Color(0xFF7C3AED) : (const [1, 3, 7, 9].contains(i) ? const Color(0xFF10B981) : const Color(0xFFEF4444)),
                                multiplier: 9.0,
                              ),
                              child: _buildNumberButton(i),
                            );
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // 4. Big / Small Buttons
                  Row(
                    children: [
                      Expanded(
                        child: GestureDetector(
                          onTap: () => _openBetModal(
                            betType: 'size',
                            betValue: 'big',
                            title: 'Big (5-9)',
                            accentColor: const Color(0xFF2563EB),
                            multiplier: 2.0,
                          ),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)]),
                              borderRadius: BorderRadius.circular(14),
                              boxShadow: [
                                BoxShadow(color: const Color(0xFF2563EB).withOpacity(0.4), blurRadius: 6, offset: const Offset(0, 2)),
                              ],
                            ),
                            alignment: Alignment.center,
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text('🔵 BIG (5–9)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15)),
                                SizedBox(width: 6),
                                Text('2x', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: GestureDetector(
                          onTap: () => _openBetModal(
                            betType: 'size',
                            betValue: 'small',
                            title: 'Small (0-4)',
                            accentColor: const Color(0xFFD97706),
                            multiplier: 2.0,
                          ),
                          child: Container(
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(colors: [Color(0xFFD97706), Color(0xFFB45309)]),
                              borderRadius: BorderRadius.circular(14),
                              boxShadow: [
                                BoxShadow(color: const Color(0xFFD97706).withOpacity(0.4), blurRadius: 6, offset: const Offset(0, 2)),
                              ],
                            ),
                            alignment: Alignment.center,
                            child: const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text('🟠 SMALL (0–4)', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 15)),
                                SizedBox(width: 6),
                                Text('2x', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // 5. Tabs: Game Record, Trend, My Bets
                  TabBar(
                    controller: _tabController,
                    indicatorColor: const Color(0xFF10B981),
                    indicatorWeight: 3,
                    labelColor: Colors.white,
                    unselectedLabelColor: Colors.white54,
                    tabs: const [
                      Tab(text: 'Game Record'),
                      Tab(text: 'Trend Chart'),
                      Tab(text: 'My Bets'),
                    ],
                  ),
                  const SizedBox(height: 12),

                  SizedBox(
                    height: 380,
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        // Tab 1: Game Record
                        _buildGameRecordTab(),
                        // Tab 2: Trend Chart
                        _buildTrendChartTab(),
                        // Tab 3: My Bets
                        _buildMyBetsTab(),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildColorCard({
    required String title,
    required String multiplier,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [color, color.withOpacity(0.75)],
          ),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: color.withOpacity(0.4), blurRadius: 8, offset: const Offset(0, 3)),
          ],
        ),
        child: Column(
          children: [
            Text(
              'Join $title',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16),
            ),
            const SizedBox(height: 2),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.2),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                multiplier,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 11),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNumberButton(int num) {
    if (num == 0) {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: const LinearGradient(
            colors: [Color(0xFF7C3AED), Color(0xFFEF4444)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        alignment: Alignment.center,
        child: const Text('0', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
      );
    }
    if (num == 5) {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: const LinearGradient(
            colors: [Color(0xFF7C3AED), Color(0xFF10B981)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
        ),
        alignment: Alignment.center,
        child: const Text('5', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
      );
    }
    final isGreen = const [1, 3, 7, 9].contains(num);
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        color: isGreen ? const Color(0xFF10B981) : const Color(0xFFEF4444),
      ),
      alignment: Alignment.center,
      child: Text('$num', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 20)),
    );
  }

  Widget _buildGameRecordTab() {
    if (_history.isEmpty) {
      return const Center(child: Text('No draw history yet', style: TextStyle(color: Colors.white54)));
    }

    return ListView.builder(
      itemCount: _history.length,
      itemBuilder: (_, i) {
        final row = _history[i];
        final period = row['period_id']?.toString() ?? '—';
        final num = row['winning_number'] ?? 0;
        final size = row['winning_size']?.toString().toUpperCase() ?? '—';

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFF1A2130),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFF263147)),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(period, style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 13, fontFamily: 'monospace')),
              Row(
                children: [
                  _buildColorBall(num, size: 28, fontSize: 13),
                  const SizedBox(width: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: size == 'BIG' ? const Color(0xFF2563EB).withOpacity(0.2) : const Color(0xFFD97706).withOpacity(0.2),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: size == 'BIG' ? const Color(0xFF2563EB) : const Color(0xFFD97706)),
                    ),
                    child: Text(
                      size,
                      style: TextStyle(
                        color: size == 'BIG' ? const Color(0xFF60A5FA) : const Color(0xFFFBBF24),
                        fontWeight: FontWeight.w900,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildTrendChartTab() {
    if (_history.isEmpty) {
      return const Center(child: Text('No trend data available', style: TextStyle(color: Colors.white54)));
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1A2130),
        borderRadius: BorderRadius.circular(14),
      ),
      child: GridView.builder(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 5,
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.0,
        ),
        itemCount: _history.length,
        itemBuilder: (_, i) {
          final row = _history[i];
          final num = row['winning_number'] ?? 0;
          final periodStr = row['period_id']?.toString() ?? '';
          return Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _buildColorBall(num, size: 36, fontSize: 15),
              const SizedBox(height: 4),
              Text(
                periodStr.length >= 4 ? periodStr.substring(periodStr.length - 4) : periodStr,
                style: const TextStyle(color: Colors.white54, fontSize: 10),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildMyBetsTab() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'My Bet History (${_myBets.length})',
                style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 13),
              ),
              IconButton(
                icon: const Icon(Icons.refresh, color: Color(0xFF10B981), size: 20),
                onPressed: () {
                  _fetchMyBets();
                  _fetchWalletBalance();
                },
                tooltip: 'Refresh Bets',
              ),
            ],
          ),
        ),
        if (_myBets.isEmpty)
          const Expanded(
            child: Center(
              child: Text(
                'You have not placed any bets in Color Prediction yet.\nSelect a color or number above to start playing!',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, height: 1.5),
              ),
            ),
          )
        else
          Expanded(
            child: ListView.builder(
              itemCount: _myBets.length,
              itemBuilder: (_, i) {
                final bet = _myBets[i];
                final status = bet['status']?.toString().toLowerCase() ?? 'pending';
                final isWon = status == 'won';
                final isLost = status == 'lost';
                final amount = double.tryParse(bet['amount']?.toString() ?? '') ?? 0.0;
                final payout = double.tryParse(bet['payout']?.toString() ?? '') ?? 0.0;

                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A2130),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: isWon
                          ? const Color(0xFF10B981).withOpacity(0.6)
                          : (isLost ? const Color(0xFFEF4444).withOpacity(0.3) : Colors.amber.withOpacity(0.3)),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Period: ${bet['period_id']}', style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.bold, fontSize: 12, fontFamily: 'monospace')),
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF2A344A),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '${bet['bet_type']?.toString().toUpperCase()}: ${bet['bet_value']?.toString().toUpperCase()}',
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 11),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text('Stake: ₹${amount.toStringAsFixed(0)}', style: const TextStyle(color: Colors.white60, fontSize: 11, fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ],
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          if (isWon) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(color: const Color(0xFF10B981).withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
                              child: const Text('WON 🏆', style: TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.w900, fontSize: 10)),
                            ),
                            const SizedBox(height: 2),
                            Text('+₹${payout.toStringAsFixed(2)}', style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.w900, fontSize: 16)),
                          ] else if (isLost) ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(color: const Color(0xFFEF4444).withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
                              child: const Text('LOST', style: TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.w900, fontSize: 10)),
                            ),
                            const SizedBox(height: 2),
                            Text('-₹${amount.toStringAsFixed(0)}', style: const TextStyle(color: Color(0xFFEF4444), fontWeight: FontWeight.bold, fontSize: 14)),
                          ] else ...[
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(color: Colors.amber.withOpacity(0.2), borderRadius: BorderRadius.circular(6)),
                              child: const Text('PENDING', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.w900, fontSize: 10)),
                            ),
                            const SizedBox(height: 2),
                            const Text('Drawing...', style: TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 12)),
                          ],
                        ],
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      );
  }

  Widget _buildModeSelector() {
    final modes = [
      {'id': '30s', 'label': '30s', 'title': 'Fast Parity', 'icon': Icons.bolt, 'color': const Color(0xFF10B981)},
      {'id': '1m', 'label': '1M', 'title': 'WinGo 1M', 'icon': Icons.timer, 'color': const Color(0xFF3B82F6)},
      {'id': '3m', 'label': '3M', 'title': 'WinGo 3M', 'icon': Icons.hourglass_top, 'color': const Color(0xFF8B5CF6)},
      {'id': '5m', 'label': '5M', 'title': 'WinGo 5M', 'icon': Icons.schedule, 'color': const Color(0xFFF59E0B)},
    ];

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFF161B26),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF263147)),
      ),
      child: Row(
        children: modes.map((m) {
          final modeId = m['id'] as String;
          final isSelected = _selectedMode == modeId;
          final color = m['color'] as Color;
          return Expanded(
            child: GestureDetector(
              onTap: () {
                if (_selectedMode != modeId) {
                  HapticFeedback.selectionClick();
                  setState(() {
                    _selectedMode = modeId;
                    _isLoading = true;
                  });
                  _fetchData();
                }
              },
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: isSelected ? color : Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: isSelected
                      ? [BoxShadow(color: color.withOpacity(0.4), blurRadius: 8, offset: const Offset(0, 2))]
                      : [],
                ),
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(m['icon'] as IconData, size: 14, color: isSelected ? Colors.white : Colors.white54),
                        const SizedBox(width: 4),
                        Text(
                          m['label'] as String,
                          style: TextStyle(
                            color: isSelected ? Colors.white : Colors.white70,
                            fontWeight: FontWeight.w900,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      m['title'] as String,
                      style: TextStyle(
                        color: isSelected ? Colors.white.withOpacity(0.9) : Colors.white38,
                        fontSize: 9,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class GestureBarChip extends StatelessWidget {
  final double balance;
  final VoidCallback onRefresh;

  const GestureBarChip({super.key, required this.balance, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onRefresh,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF242C3D),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFF38455E)),
        ),
        child: Row(
          children: [
            const Icon(Icons.account_balance_wallet, color: Colors.amber, size: 16),
            const SizedBox(width: 6),
            Text(
              '₹${balance.toStringAsFixed(2)}',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}
