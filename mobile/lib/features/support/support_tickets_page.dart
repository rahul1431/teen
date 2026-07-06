import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/error_retry.dart';

class SupportTicketsPage extends StatefulWidget {
  const SupportTicketsPage({super.key});

  @override
  State<SupportTicketsPage> createState() => _SupportTicketsPageState();
}

class _SupportTicketsPageState extends State<SupportTicketsPage> {
  final _api = ApiClient();
  List<dynamic> _tickets = [];
  bool _loading = true;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _hasError = false;
    });
    try {
      final res = await _api.dio.get('/api/support/tickets');
      if (!mounted) return;
      setState(() {
        _tickets = res.data['tickets'] as List? ?? [];
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _hasError = true;
        });
      }
    }
  }

  void _openCreateTicketSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (context) => _CreateTicketSheet(api: _api, onSuccess: _load),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Support Tickets'),
      ),
      body: _buildBody(),
      floatingActionButton: FloatingActionButton(
        onPressed: _openCreateTicketSheet,
        backgroundColor: AppColors.gold,
        foregroundColor: Colors.black,
        child: const Icon(Icons.add_rounded),
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_hasError) {
      return Center(child: ErrorRetry(message: 'Could not load tickets', onRetry: _load));
    }
    if (_tickets.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('🎫', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 12),
            const Text(
              'No tickets opened yet',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            const Text(
              'Need help? Raise a support ticket and our team will assist you.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: _openCreateTicketSheet,
              child: const Text('Raise Ticket'),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.gold,
      backgroundColor: AppColors.surface,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: _tickets.length,
        itemBuilder: (context, idx) {
          final t = _tickets[idx];
          final status = t['status']?.toString() ?? 'open';
          final category = t['category']?.toString() ?? 'general';
          final count = t['message_count'] ?? 0;
          
          Color badgeColor;
          if (status == 'resolved' || status == 'closed') {
            badgeColor = AppColors.green;
          } else if (status == 'in_progress') {
            badgeColor = AppColors.orange;
          } else {
            badgeColor = AppColors.red;
          }

          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.border),
            ),
            child: ListTile(
              contentPadding: const EdgeInsets.all(16),
              title: Row(
                children: [
                  Expanded(
                    child: Text(
                      t['subject'] ?? 'No Subject',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: badgeColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: badgeColor.withOpacity(0.5), width: 0.5),
                    ),
                    child: Text(
                      status.toUpperCase().replaceAll('_', ' '),
                      style: TextStyle(color: badgeColor, fontSize: 9, fontWeight: FontWeight.bold),
                    ),
                  ),
                ],
              ),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Category: ${category.toUpperCase()}',
                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                    ),
                    Row(
                      children: [
                        const Icon(Icons.forum_outlined, size: 12, color: AppColors.textSecondary),
                        const SizedBox(width: 4),
                        Text(
                          '$count message${count != 1 ? 's' : ''}',
                          style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (context) => TicketChatPage(ticketId: t['id']),
                  ),
                ).then((_) => _load());
              },
            ),
          );
        },
      ),
    );
  }
}

class _CreateTicketSheet extends StatefulWidget {
  final ApiClient api;
  final VoidCallback onSuccess;
  const _CreateTicketSheet({required this.api, required this.onSuccess});

  @override
  State<_CreateTicketSheet> createState() => _CreateTicketSheetState();
}

class _CreateTicketSheetState extends State<_CreateTicketSheet> {
  final _subjectCtrl = TextEditingController();
  final _messageCtrl = TextEditingController();
  String _category = 'general';
  bool _submitting = false;

  final List<String> _categories = ['general', 'deposit', 'withdrawal', 'gameplay', 'other'];

  Future<void> _submit() async {
    final subject = _subjectCtrl.text.trim();
    final message = _messageCtrl.text.trim();

    if (subject.isEmpty) {
      AppSnackBar.show(context, 'Subject cannot be empty', error: true);
      return;
    }
    if (message.isEmpty) {
      AppSnackBar.show(context, 'Message cannot be empty', error: true);
      return;
    }

    setState(() => _submitting = true);
    try {
      await widget.api.dio.post('/api/support/tickets', data: {
        'subject': subject,
        'category': _category,
        'message': message,
      });
      if (mounted) {
        widget.onSuccess();
        Navigator.pop(context);
        AppSnackBar.show(context, 'Support ticket created successfully', success: true);
      }
    } catch (_) {
      if (mounted) {
        AppSnackBar.show(context, 'Failed to create support ticket', error: true);
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Raise Support Ticket', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          TextField(
            controller: _subjectCtrl,
            decoration: const InputDecoration(labelText: 'Subject', hintText: 'e.g. Deposit issue'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _category,
            dropdownColor: AppColors.surface,
            decoration: const InputDecoration(labelText: 'Category'),
            items: _categories.map((c) => DropdownMenuItem(value: c, child: Text(c.toUpperCase()))).toList(),
            onChanged: (val) {
              if (val != null) setState(() => _category = val);
            },
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _messageCtrl,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Describe your issue in detail', hintText: 'Provide transaction ID, game room ID, etc.'),
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Text('Submit Ticket'),
            ),
          ),
        ],
      ),
    );
  }
}

class TicketChatPage extends StatefulWidget {
  final String ticketId;
  const TicketChatPage({super.key, required this.ticketId});

  @override
  State<TicketChatPage> createState() => _TicketChatPageState();
}

class _TicketChatPageState extends State<TicketChatPage> {
  final _api = ApiClient();
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  
  Map<String, dynamic>? _ticket;
  List<dynamic> _messages = [];
  bool _loading = true;
  bool _sending = false;
  bool _hasError = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await _api.dio.get('/api/support/tickets/${widget.ticketId}');
      if (!mounted) return;
      setState(() {
        _ticket = res.data['ticket'];
        _messages = res.data['messages'] as List? ?? [];
        _loading = false;
        _hasError = false;
      });
      Future.delayed(const Duration(milliseconds: 100), _scrollToBottom);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _hasError = true;
        });
      }
    }
  }

  void _scrollToBottom() {
    if (_scrollCtrl.hasClients) {
      _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent);
    }
  }

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;

    setState(() => _sending = true);
    try {
      await _api.dio.post('/api/support/tickets/${widget.ticketId}/messages', data: {'body': text});
      _msgCtrl.clear();
      _scrollToBottom();
      await _load();
    } catch (_) {
      if (mounted) {
        AppSnackBar.show(context, 'Failed to send message', error: true);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    String title = 'Ticket Detail';
    String status = 'open';
    if (_ticket != null) {
      title = _ticket!['subject'] ?? 'Ticket Detail';
      status = _ticket!['status'] ?? 'open';
    }

    final isClosed = status == 'resolved' || status == 'closed';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(title, style: const TextStyle(fontSize: 15)),
        actions: [
          if (_ticket != null)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: isClosed ? AppColors.green.withOpacity(0.15) : AppColors.red.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: TextStyle(color: isClosed ? AppColors.green : AppColors.red, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: _buildBody(isClosed),
    );
  }

  Widget _buildBody(bool isClosed) {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_hasError) {
      return Center(child: ErrorRetry(message: 'Could not load ticket details', onRetry: _load));
    }

    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            color: AppColors.gold,
            backgroundColor: AppColors.surface,
            child: ListView.builder(
              controller: _scrollCtrl,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, idx) {
                final m = _messages[idx];
                final isAdmin = m['sender_type'] == 'admin';
                final alignLeft = isAdmin;
                final bubbleBg = alignLeft ? AppColors.surface : AppColors.gold.withOpacity(0.15);
                final bubbleBorder = Border.all(color: alignLeft ? AppColors.border : AppColors.gold.withOpacity(0.3));
                final align = alignLeft ? CrossAxisAlignment.start : CrossAxisAlignment.end;
                
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: align,
                    children: [
                      Row(
                        mainAxisAlignment: alignLeft ? MainAxisAlignment.start : MainAxisAlignment.end,
                        children: [
                          Text(
                            alignLeft ? 'Support Team' : 'You',
                            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: AppColors.textSecondary),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            DateTime.parse(m['created_at']).toLocal().toString().substring(11, 16),
                            style: const TextStyle(fontSize: 10, color: AppColors.textSecondary),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: bubbleBg,
                          borderRadius: BorderRadius.circular(12),
                          border: bubbleBorder,
                        ),
                        child: Text(
                          m['body'] ?? '',
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
        if (isClosed)
          Container(
            padding: const EdgeInsets.all(16),
            color: AppColors.surface,
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.lock, size: 16, color: AppColors.textSecondary),
                SizedBox(width: 8),
                Text(
                  'This ticket is closed. Reply to reopen.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                ),
              ],
            ),
          ),
        Container(
          padding: EdgeInsets.only(
            left: 12,
            right: 12,
            top: 8,
            bottom: 8 + MediaQuery.of(context).viewInsets.bottom,
          ),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(top: BorderSide(color: AppColors.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _msgCtrl,
                  decoration: const InputDecoration(
                    hintText: 'Type your message...',
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    filled: false,
                  ),
                  onSubmitted: (_) => _sendMessage(),
                ),
              ),
              IconButton(
                onPressed: _sending ? null : _sendMessage,
                icon: const Icon(Icons.send_rounded, color: AppColors.gold),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
