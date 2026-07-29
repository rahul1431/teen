import 'package:flutter/material.dart';
import '../../core/network/api_client.dart';
import '../../shared/theme/app_theme.dart';

/// Fetches and renders a single admin-authored `cms_pages` row (Support &
/// CMS → CMS Pages tab) by slug — e.g. 'terms', 'privacy', 'faq'. Published
/// pages only (`GET /api/users/pages/:slug`, 404s on unpublished/missing).
///
/// Not currently linked from any nav entry: the app has no existing
/// Terms/Privacy/legal screen or menu item to hang this off of. Whoever owns
/// the Profile/Settings navigation should add a route + entry point that
/// pushes `CmsPageView(slug: 'terms')` etc. once the IA is decided.
class CmsPageView extends StatefulWidget {
  final String slug;
  const CmsPageView({super.key, required this.slug});

  @override
  State<CmsPageView> createState() => _CmsPageViewState();
}

class _CmsPageViewState extends State<CmsPageView> {
  Map<String, dynamic>? _page;
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
      final res = await ApiClient().dio.get('/api/users/pages/${widget.slug}');
      if (!mounted) return;
      setState(() {
        _page = res.data as Map<String, dynamic>;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _hasError = true;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(_page?['title'] as String? ?? '')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _hasError
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Could not load this page',
                          style: TextStyle(color: AppColors.textSecondary)),
                      const SizedBox(height: 12),
                      OutlinedButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: SelectableText(
                    _page?['body_md'] as String? ?? '',
                    style: const TextStyle(
                        color: AppColors.textPrimary, fontSize: 14, height: 1.5),
                  ),
                ),
    );
  }
}
