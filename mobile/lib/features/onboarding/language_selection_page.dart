import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/services/locale_service.dart';
import '../../shared/theme/app_theme.dart';

/// Language picker. In onboarding mode (first launch) it blocks until a
/// choice is made, then marks first-launch done and continues to splash.
/// From Profile it's pushed as a normal page and pops back on selection.
class LanguageSelectionPage extends StatefulWidget {
  final bool isOnboarding;
  const LanguageSelectionPage({super.key, this.isOnboarding = false});

  @override
  State<LanguageSelectionPage> createState() => _LanguageSelectionPageState();
}

class _LanguageSelectionPageState extends State<LanguageSelectionPage> {
  late String _selected = locale.current.code;

  Future<void> _continue() async {
    await locale.setLanguage(_selected);
    if (!mounted) return;
    if (widget.isOnboarding) {
      await LocaleService.markFirstLaunchDone();
      if (mounted) context.go('/splash');
    } else {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: widget.isOnboarding
          ? null
          : AppBar(title: Text(locale.t('language'))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Header + language list scroll on short screens; the Continue
              // button stays pinned below.
              Expanded(
                child: SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (widget.isOnboarding) ...[
                        const SizedBox(height: 40),
                const Text('🃏', textAlign: TextAlign.center, style: TextStyle(fontSize: 56)),
                const SizedBox(height: 12),
                const Text('MyOnlineJoker',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.gold, fontSize: 26, fontWeight: FontWeight.w900)),
                const SizedBox(height: 32),
              ],
              Text(locale.t('choose_language'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 20),
              ...LocaleService.languages.map((l) {
                final selected = l.code == _selected;
                return GestureDetector(
                  onTap: () => setState(() => _selected = l.code),
                  child: Container(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.gold.withOpacity(0.12) : AppColors.surface,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: selected ? AppColors.gold : AppColors.border,
                        width: selected ? 1.5 : 1,
                      ),
                    ),
                    child: Row(
                      children: [
                        Text(l.flag, style: const TextStyle(fontSize: 24)),
                        const SizedBox(width: 14),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(l.nativeName,
                                style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                            Text(l.name,
                                style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                          ],
                        ),
                        const Spacer(),
                        if (selected)
                          const Icon(Icons.check_circle_rounded, color: AppColors.gold),
                      ],
                    ),
                  ),
                );
              }),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 52,
                child: ElevatedButton(
                  onPressed: _continue,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: Colors.black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  ),
                  child: Text(locale.t('continue'),
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
