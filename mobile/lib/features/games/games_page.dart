import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/cms_banner_strip.dart';
import '../../core/services/locale_service.dart';
import '../../core/services/app_config_service.dart';

/// Games tab — every game on the platform in one grid.
class GamesPage extends StatelessWidget {
  const GamesPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: CmsBannerStrip(placement: 'lobby'),
          ),
          Expanded(
            child: ValueListenableBuilder<int>(
              valueListenable: AppConfigService.changeNotifier,
              builder: (context, _, __) {
                final allGames = [
                  _Game(
                      locale.t('teen_patti'),
                      '🃏',
                      'Classic 3-card showdown',
                      AppColors.teenPattiGrad,
                      const Color(0xFFFF6B6B),
                      '/games/teen-patti',
                      typeKey: 'teen_patti'),
                  _Game(
                      locale.t('aviator'),
                      '✈️',
                      'Cash out before the crash',
                      AppColors.aviatorGrad,
                      const Color(0xFF60A5FA),
                      '/games/aviator',
                      typeKey: 'aviator'),
                  _Game(
                      locale.t('ludo'),
                      '🎲',
                      'Race your tokens home',
                      AppColors.ludoGrad,
                      const Color(0xFFCE93D8),
                      '/games/ludo',
                      typeKey: 'ludo'),
                  _Game(
                      locale.t('rummy'),
                      '🂡',
                      'Meld sets and sequences',
                      AppColors.rummyGrad,
                      const Color(0xFF5EEAD4),
                      '/games/rummy',
                      typeKey: 'rummy'),
                  _Game(
                      locale.t('cricket'),
                      '🏏',
                      'Bet on live matches',
                      AppColors.cricketGrad,
                      const Color(0xFF86EFAC),
                      '/games/cricket',
                      typeKey: 'cricket'),
                  _Game(
                      locale.t('matka'),
                      '🏺',
                      'Pick your lucky numbers',
                      AppColors.matkaGrad,
                      AppColors.orange,
                      '/games/matka',
                      typeKey: 'matka'),
                  _Game(
                      locale.t('lottery'),
                      '🎰',
                      'Jackpot up to ₹10 CR',
                      AppColors.lotteryGrad,
                      const Color(0xFF2DD4BF),
                      '/games/lottery',
                      typeKey: 'lottery'),
                  _Game(
                      'Color Prediction',
                      '🎨',
                      'Fast 30s Wingo Parity',
                      AppColors.colorPredictionGrad,
                      const Color(0xFFA78BFA),
                      '/games/color-prediction',
                      typeKey: 'color_prediction'),
                ];

                final activeGames = allGames
                    .where((g) => AppConfigService.isGameEnabled(g.typeKey))
                    .toList();

                if (activeGames.isEmpty) {
                  return const Center(
                    child: Text('No games currently active',
                        style: TextStyle(color: AppColors.textSecondary)),
                  );
                }

                return GridView.builder(
                  padding: const EdgeInsets.all(16),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 0.95,
                  ),
                  itemCount: activeGames.length,
                  itemBuilder: (_, i) => _GameCard(game: activeGames[i]),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Game {
  final String title;
  final String emoji;
  final String subtitle;
  final List<Color> gradient;
  final Color accent;
  final String route;
  final String typeKey;
  final bool isComingSoon;
  const _Game(this.title, this.emoji, this.subtitle, this.gradient, this.accent,
      this.route, {required this.typeKey, this.isComingSoon = false});
}

class _GameCard extends StatelessWidget {
  final _Game game;
  const _GameCard({required this.game});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        if (game.isComingSoon) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('${game.title} is coming soon! 🚀'),
              backgroundColor: AppColors.surface,
              duration: const Duration(seconds: 2),
            ),
          );
        } else {
          String targetRoute = game.route;
          if (AppConfigService.isSafeMode()) {
            if (targetRoute.contains('teen-patti')) {
              targetRoute = '/games/teen-patti/play/offline-practice';
            } else if (targetRoute.contains('ludo')) {
              targetRoute = '/games/ludo/practice';
            } else if (targetRoute.contains('rummy')) {
              targetRoute = '/games/rummy/practice';
            }
          }
          context.push(targetRoute);
        }
      },
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: game.gradient,
          ),
          borderRadius: BorderRadius.circular(20),
          border:
              Border.all(color: game.accent.withValues(alpha: 0.3), width: 1.5),
          boxShadow: [
            BoxShadow(
              color: game.gradient.first.withValues(alpha: 0.4),
              blurRadius: 16,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(game.emoji, style: const TextStyle(fontSize: 34)),
              const Spacer(),
              Text(game.title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                    shadows: [Shadow(color: Colors.black38, blurRadius: 4)],
                  )),
              const SizedBox(height: 3),
              Text(game.subtitle,
                  style: TextStyle(
                      color: game.accent,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600)),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 7),
                decoration: BoxDecoration(
                  color: game.isComingSoon
                      ? Colors.white10
                      : game.accent.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                    color: game.isComingSoon
                        ? Colors.white24
                        : game.accent.withValues(alpha: 0.5),
                  ),
                ),
                child: Text(
                  game.isComingSoon ? 'Coming Soon' : 'Play Now',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: game.isComingSoon ? Colors.white60 : game.accent,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
