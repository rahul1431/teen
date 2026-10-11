import 'package:flutter/material.dart';
import '../../../../../shared/theme/app_theme.dart';

class SectionHeader extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String? trailing;
  const SectionHeader({super.key, required this.icon, required this.iconColor, required this.title, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: iconColor, size: 16),
        const SizedBox(width: 6),
        Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
        if (trailing != null) ...[
          const Spacer(),
          Text(trailing!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 10)),
        ],
      ],
    );
  }
}
