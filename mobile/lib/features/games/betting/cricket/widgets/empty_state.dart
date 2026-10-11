import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';

class CricketEmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  const CricketEmptyState({super.key, required this.icon, required this.title, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: AppColors.textSecondary, size: 48),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(color: AppColors.textSecondary)),
          if (subtitle != null) ...[
            const SizedBox(height: 4),
            Text(subtitle!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
          ],
        ],
      ),
    );
  }
}
