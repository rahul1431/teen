import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../agent_theme.dart';
import '../models/agent_models.dart';
import '../services/agent_api_service.dart';

class AgentSupportScreen extends StatefulWidget {
  final AgentProfile? profile;
  const AgentSupportScreen({super.key, this.profile});

  @override
  State<AgentSupportScreen> createState() => _AgentSupportScreenState();
}

class _AgentSupportScreenState extends State<AgentSupportScreen> {
  final _api = AgentApiService();
  final _subjectCtrl = TextEditingController();
  final _messageCtrl = TextEditingController();
  String _selectedCategory = 'Commissions & Payouts';
  bool _isSubmitting = false;

  final List<String> _categories = [
    'Commissions & Payouts',
    'Player Attribution & Binding',
    'KYC & Bank Details',
    'Sub-Agent Network',
    'App & Technical Issues',
    'Other Inquiries',
  ];

  @override
  void dispose() {
    _subjectCtrl.dispose();
    _messageCtrl.dispose();
    super.dispose();
  }

  Future<void> _launchUrl(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Could not launch: $url'),
            backgroundColor: AgentTheme.lossRed,
          ),
        );
      }
    }
  }

  Future<void> _openWhatsApp() async {
    final username = widget.profile?.username ?? 'Agent';
    final ref = widget.profile?.referralCode ?? '';
    final text = Uri.encodeComponent(
      'Hello Joker Support, I am Agent @$username (Referral Code: $ref). I need assistance with: ',
    );
    await _launchUrl('https://wa.me/919999999999?text=$text');
  }

  Future<void> _openTelegram() async {
    await _launchUrl('https://t.me/myonlinejoker_support');
  }

  Future<void> _submitTicket() async {
    final subject = _subjectCtrl.text.trim();
    final message = _messageCtrl.text.trim();

    if (subject.isEmpty || message.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter both subject and message.'),
          backgroundColor: AgentTheme.lossRed,
        ),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final res = await _api.submitSupportTicket(
        subject: subject,
        category: _selectedCategory,
        message: message,
      );
      if (mounted) {
        _subjectCtrl.clear();
        _messageCtrl.clear();
        showDialog(
          context: context,
          builder: (ctx) => AlertDialog(
            backgroundColor: AgentTheme.surface,
            title: const Row(
              children: [
                Icon(Icons.check_circle, color: AgentTheme.winGreen),
                SizedBox(width: 8),
                Text('Ticket Submitted', style: TextStyle(color: Colors.white)),
              ],
            ),
            content: Text(
              '${res['message']}\nTicket ID: ${res['ticket_id']}',
              style: const TextStyle(color: Colors.white70),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('OK', style: TextStyle(color: AgentTheme.gold)),
              ),
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceAll('Exception: ', '')),
            backgroundColor: AgentTheme.lossRed,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Agent Support & Helpdesk'),
        backgroundColor: AgentTheme.surface,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          child: [
            _buildContactChannels(),
            const SizedBox(height: 20),
            _buildTicketForm(),
            const SizedBox(height: 20),
            _buildFaqSection(),
          ],
        ),
      ),
    );
  }

  Widget _buildContactChannels() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Quick Contact Channels',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildChannelCard(
                icon: Icons.chat,
                title: 'WhatsApp',
                subtitle: 'Direct Admin Chat',
                color: const Color(0xFF25D366),
                onTap: _openWhatsApp,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildChannelCard(
                icon: Icons.send,
                title: 'Telegram',
                subtitle: 'Official Support',
                color: const Color(0xFF0088CC),
                onTap: _openTelegram,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildChannelCard(
                icon: Icons.phone_in_talk,
                title: 'Call Support',
                subtitle: '+91 99999 99999',
                color: Colors.orangeAccent,
                onTap: () => _launchUrl('tel:+919999999999'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildChannelCard(
                icon: Icons.email_outlined,
                title: 'Email Us',
                subtitle: 'support@game.myonlinejoker.com',
                color: Colors.blueAccent,
                onTap: () => _launchUrl('mailto:support@game.myonlinejoker.com?subject=Agent%20Support'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildChannelCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AgentTheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: color.withOpacity(0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.15),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: 10),
            Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AgentTheme.textMuted, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTicketForm() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.confirmation_number_outlined, color: AgentTheme.gold, size: 20),
              SizedBox(width: 8),
              Text(
                'Submit Support Ticket',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          const Text('Category', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: Colors.black26,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white12),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedCategory,
                dropdownColor: AgentTheme.surfaceElevated,
                isExpanded: true,
                style: const TextStyle(color: Colors.white, fontSize: 14),
                items: _categories.map((c) {
                  return DropdownMenuItem(value: c, child: Text(c));
                }).toList(),
                onChanged: (val) {
                  if (val != null) setState(() => _selectedCategory = val);
                },
              ),
            ),
          ),
          const SizedBox(height: 14),
          const Text('Subject', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
          const SizedBox(height: 6),
          TextField(
            controller: _subjectCtrl,
            style: const TextStyle(color: Colors.white, fontSize: 14),
            decoration: InputDecoration(
              hintText: 'e.g. Settlement issue for 01 Nov',
              hintStyle: const TextStyle(color: AgentTheme.textMuted),
              filled: true,
              fillColor: Colors.black26,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Colors.white12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Colors.white12),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AgentTheme.gold),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
          ),
          const SizedBox(height: 14),
          const Text('Message / Details', style: TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
          const SizedBox(height: 6),
          TextField(
            controller: _messageCtrl,
            maxLines: 4,
            style: const TextStyle(color: Colors.white, fontSize: 14),
            decoration: InputDecoration(
              hintText: 'Describe your question or issue in detail...',
              hintStyle: const TextStyle(color: AgentTheme.textMuted),
              filled: true,
              fillColor: Colors.black26,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Colors.white12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: Colors.white12),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: const BorderSide(color: AgentTheme.gold),
              ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _isSubmitting ? null : _submitTicket,
              icon: _isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black),
                    )
                  : const Icon(Icons.send, color: Colors.black, size: 18),
              label: Text(
                _isSubmitting ? 'Submitting...' : 'Submit Ticket',
                style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AgentTheme.gold,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: BorderRadius.circular(10),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFaqSection() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.help_outline, color: AgentTheme.gold, size: 20),
              SizedBox(width: 8),
              Text(
                'Frequently Asked Questions',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildFaqItem(
            'How is agent commission calculated?',
            'Commissions are calculated daily based on the game turnover of your direct players and sub-agents. You receive your base commission percentage on direct turnover, plus override spread on sub-agents.',
          ),
          _buildFaqItem(
            'When are daily commissions credited?',
            'The automated settlement job runs every night at 00:00 UTC. Your earnings are credited directly to your Agent Wallet.',
          ),
          _buildFaqItem(
            'What is the minimum payout amount?',
            'The minimum payout request is ₹100. Payouts to your registered Bank Account or UPI ID are processed within 1-2 hours.',
          ),
          _buildFaqItem(
            'How do players bind to my account?',
            'When players sign up using your referral link or enter your referral code during registration, they are automatically bound to you. Admins can also manually assign players to your agent account.',
          ),
        ],
      ),
    );
  }

  Widget _buildFaqItem(String question, String answer) {
    return ExpansionTile(
      collapsedIconColor: AgentTheme.gold,
      iconColor: AgentTheme.gold,
      tilePadding: EdgeInsets.zero,
      title: Text(
        question,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            answer,
            style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12, height: 1.4),
          ),
        ),
      ],
    );
  }
}
