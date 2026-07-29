import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/network/api_client.dart';
import '../../core/constants/app_config.dart';
import '../theme/app_theme.dart';

String _resolveCmsImageUrl(String? p) {
  if (p == null || p.isEmpty) return '';
  if (p.startsWith('http')) return p;
  return '${AppConfig.apiBaseUrl}$p';
}

/// Renders admin-authored `cms_banners` (Support & CMS → Banners tab) for a
/// given `placement` (home/lobby/wallet/promo). Fetches
/// `GET /api/users/cms-banners?placement=...` and renders nothing (zero
/// height) if there are no active banners for that placement, so it's safe
/// to drop into any screen without reserving layout space.
class CmsBannerStrip extends StatefulWidget {
  final String placement;
  const CmsBannerStrip({super.key, required this.placement});

  @override
  State<CmsBannerStrip> createState() => _CmsBannerStripState();
}

class _CmsBannerStripState extends State<CmsBannerStrip> {
  List<dynamic> _banners = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiClient().dio.get('/api/users/cms-banners',
          queryParameters: {'placement': widget.placement});
      if (!mounted) return;
      final list = res.data as List? ?? [];
      if (list.isEmpty) return;
      setState(() => _banners = list);
    } catch (_) {
      // Silently ignore — banners are decorative, never block the host screen.
    }
  }

  Future<void> _onTap(Map<String, dynamic> banner) async {
    final url = banner['cta_url'] as String? ?? '';
    if (url.isEmpty) return;
    if (url.startsWith('/')) {
      context.push(url);
      return;
    }
    final uri = Uri.tryParse(url);
    if (uri != null) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_banners.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 110,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: _banners.length,
        itemBuilder: (_, i) {
          final b = _banners[i] as Map<String, dynamic>;
          final imgUrl = _resolveCmsImageUrl(b['image_url'] as String?);
          final title = b['title'] as String? ?? '';
          final ctaLabel = b['cta_label'] as String?;
          return GestureDetector(
            onTap: () => _onTap(b),
            child: Container(
              width: 260,
              margin: const EdgeInsets.only(right: 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
                color: AppColors.surface,
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (imgUrl.isNotEmpty)
                    Image.network(imgUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(color: AppColors.cardBg)),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: 0,
                    child: Container(
                      padding: const EdgeInsets.fromLTRB(12, 18, 12, 10),
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: [Color(0xCC000000), Colors.transparent],
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w800)),
                          if (ctaLabel != null && ctaLabel.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Text(ctaLabel,
                                  style: const TextStyle(
                                      color: AppColors.gold,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700)),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
