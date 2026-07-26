import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../shared/theme/app_theme.dart';
import 'support_tickets_page.dart';

class SupportPage extends StatelessWidget {
  const SupportPage({super.key});

  static const _whatsapp = '+91 90000 00000';
  static const _email = 'support@myonlinejoker.com';

  Future<void> _open(BuildContext context, Uri uri, String fallbackText) async {
    try {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok) throw Exception();
    } catch (_) {
      await Clipboard.setData(ClipboardData(text: fallbackText));
      if (context.mounted) {
        AppSnackBar.show(context, 'Copied to clipboard: $fallbackText');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Support')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.border),
            ),
            child: const Column(
              children: [
                Text('🎧', style: TextStyle(fontSize: 44)),
                SizedBox(height: 10),
                Text('We\'re here to help',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
                SizedBox(height: 4),
                Text('Reach out any time — support is available 24×7.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 13)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _tile(
            context,
            icon: Icons.chat_rounded,
            color: AppColors.green,
            title: 'WhatsApp',
            subtitle: _whatsapp,
            onTap: () => _open(
              context,
              Uri.parse(
                  'https://wa.me/${_whatsapp.replaceAll(RegExp(r'[^\d]'), '')}'),
              _whatsapp,
            ),
          ),
          _tile(
            context,
            icon: Icons.email_rounded,
            color: AppColors.blue,
            title: 'Email',
            subtitle: _email,
            onTap: () => _open(context, Uri.parse('mailto:$_email'), _email),
          ),
          _tile(
            context,
            icon: Icons.confirmation_number_rounded,
            color: AppColors.gold,
            title: 'Raise Ticket',
            subtitle: 'Open a support ticket or view active ones',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SupportTicketsPage()),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Common questions',
                    style:
                        TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
                SizedBox(height: 10),
                _Faq('Deposit not credited?',
                    'Deposits are reviewed by our team and usually credit within 30 minutes.'),
                _Faq('Withdrawal pending?',
                    'Withdrawals are processed within 24 hours to your verified bank account.'),
                _Faq('Game disconnected mid-hand?',
                    'Rejoin from the lobby — your seat and chips are held for the round.'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _tile(BuildContext context,
      {required IconData icon,
      required Color color,
      required String title,
      required String subtitle,
      required VoidCallback onTap}) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color.withValues(alpha: 0.15),
          child: Icon(icon, color: color, size: 20),
        ),
        title: Text(title,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
        subtitle: Text(subtitle,
            style:
                const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        trailing: const Icon(Icons.chevron_right_rounded,
            color: AppColors.textSecondary),
        onTap: onTap,
      ),
    );
  }
}

class _Faq extends StatelessWidget {
  final String q;
  final String a;
  const _Faq(this.q, this.a);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(q,
              style: const TextStyle(
                  color: AppColors.gold,
                  fontSize: 13,
                  fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Text(a,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12, height: 1.4)),
        ],
      ),
    );
  }
}
