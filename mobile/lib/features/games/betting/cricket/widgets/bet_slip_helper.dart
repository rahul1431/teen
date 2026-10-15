import 'package:flutter/material.dart';
import '../../../../../core/audio/sound_service.dart';
import '../../../../../shared/theme/app_theme.dart';
import '../data/cricket_api.dart';
import '../data/cricket_models.dart';

class BetSlipHelper {
  static void showOddsBottomSheet(BuildContext context, CricketMatch match) {
    if (match.markets.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('No betting markets available for this match yet.'),
        backgroundColor: AppColors.red,
      ));
      return;
    }

    final market = match.markets.first;

    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Match Winner Odds',
                        style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Colors.white60),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${match.teamA} vs ${match.teamB}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                  const Divider(color: Colors.white10, height: 24),
                  const Text(
                    'Select Outcome:',
                    style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: market.options.map((opt) => Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ElevatedButton(
                          onPressed: () {
                            Navigator.pop(ctx);
                            _showPlaceBetDialog(context, match, market, opt);
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.gold.withValues(alpha: 0.12),
                            foregroundColor: AppColors.gold,
                            side: const BorderSide(color: AppColors.gold, width: 0.5),
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12),
                            ),
                          ),
                          child: Text(
                            '${opt.label}\n${opt.odds.toStringAsFixed(2)}x',
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    )).toList(),
                  ),
                  const SizedBox(height: 10),
                ],
              ),
            ),
          );
        }
      ),
    );
  }

  static void showPlaceBetDialog(BuildContext context, CricketMatch match, OddsMarket market, OddsMarketOption option) {
    final txt = TextEditingController(text: '100');
    double currentStake = 100.0;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (dialogCtx, setDialogState) {
          final potential = (currentStake * option.odds).toStringAsFixed(2);
          return AlertDialog(
            backgroundColor: AppColors.surface,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
            title: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'Place Bet: ${option.label}',
                    style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.gold, width: 0.5),
                  ),
                  child: Text(
                    '${option.odds.toStringAsFixed(2)}x',
                    style: const TextStyle(color: AppColors.gold, fontWeight: FontWeight.w900, fontSize: 13),
                  ),
                ),
              ],
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${match.teamA} vs ${match.teamB}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: txt,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    onChanged: (val) {
                      setDialogState(() {
                        currentStake = double.tryParse(val) ?? 0.0;
                      });
                    },
                    decoration: InputDecoration(
                      prefixText: '₹ ',
                      prefixStyle: const TextStyle(color: AppColors.gold, fontSize: 18, fontWeight: FontWeight.bold),
                      hintText: 'Enter stake',
                      hintStyle: const TextStyle(color: AppColors.textSecondary),
                      filled: true,
                      fillColor: Colors.black.withValues(alpha: 0.25),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Colors.white10)),
                      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: AppColors.gold)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  // Quick Stake Chips
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [50, 100, 500, 1000, 5000].map((preset) {
                      return InkWell(
                        onTap: () {
                          setDialogState(() {
                            currentStake = preset.toDouble();
                            txt.text = preset.toString();
                          });
                        },
                        borderRadius: BorderRadius.circular(8),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: currentStake == preset ? AppColors.gold : Colors.white.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: currentStake == preset ? AppColors.gold : Colors.white12),
                          ),
                          child: Text(
                            '+₹$preset',
                            style: TextStyle(
                              color: currentStake == preset ? Colors.black : Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.pitchGreen.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.pitchGreenLight.withValues(alpha: 0.4)),
                    ),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Potential Win:', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                        Text(
                          '₹ $potential',
                          style: const TextStyle(color: AppColors.pitchGreenLight, fontSize: 16, fontWeight: FontWeight.w900),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Cancel', style: TextStyle(color: Colors.white70)),
              ),
              ElevatedButton(
                onPressed: currentStake <= 0
                    ? null
                    : () async {
                        try {
                          await CricketApi().placeOddsBet(marketId: market.id, optionKey: option.key, amount: currentStake);
                          SoundService.instance.play(Sfx.chipBet);
                          if (ctx.mounted) {
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text('Bet placed on ${option.label} for ₹${currentStake.toStringAsFixed(0)}! 🏆'),
                                backgroundColor: AppColors.pitchGreen,
                              ),
                            );
                          }
                        } catch (err) {
                          if (ctx.mounted) {
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(err.toString()), backgroundColor: AppColors.red),
                            );
                          }
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.gold,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('Confirm Bet', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );
  }
}
