import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/cms_banner_strip.dart';
import '../../core/services/locale_service.dart';

/// Games tab — every game on the platform in one grid.
class GamesPage extends StatelessWidget {
  const GamesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final games = [
      _Game(
          locale.t('teen_patti'),
          '🃏',
          'Classic 3-card showdown',
          AppColors.teenPattiGrad,
          const Color(0xFFFF6B6B),
          '/games/teen-patti'),
      _Game(locale.t('aviator'), '✈️', 'Cash out before the crash', AppColors.aviatorGrad,
          const Color(0xFF60A5FA), '/games/aviator'),
      _Game(locale.t('ludo'), '🎲', 'Race your tokens home', AppColors.ludoGrad,
          const Color(0xFFCE93D8), '/games/ludo'),
      _Game(locale.t('rummy'), '🂡', 'Meld sets and sequences', AppColors.rummyGrad,
          const Color(0xFF5EEAD4), '/games/rummy/lobby'),
      _Game(locale.t('cricket'), '🏏', 'Bet on live matches', AppColors.cricketGrad,
          const Color(0xFF86EFAC), '/games/cricket'),
      _Game(locale.t('matka'), '🏺', 'Pick your lucky numbers', AppColors.matkaGrad,
          AppColors.orange, '/games/matka'),
      _Game(locale.t('lottery'), '🎰', 'Jackpot up to ₹10 CR', AppColors.lotteryGrad,
          const Color(0xFF2DD4BF), '/games/lottery'),
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: CmsBannerStrip(placement: 'lobby'),
          ),
          Expanded(
            child: GridView.builder(
              padding: const EdgeInsets.all(16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 0.95,
              ),
              itemCount: games.length,
              itemBuilder: (_, i) => _GameCard(game: games[i]),
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
  const _Game(this.title, this.emoji, this.subtitle, this.gradient, this.accent,
      this.route);
}

class _GameCard extends StatelessWidget {
  final _Game game;
  const _GameCard({required this.game});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => context.push(game.route),
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
                  color: game.accent.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: game.accent.withValues(alpha: 0.5)),
                ),
                child: Text('Play Now',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: game.accent,
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 0.5,
                    )),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
