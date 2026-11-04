import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';
import '../../core/constants/app_config.dart';
import '../../core/network/api_client.dart';

class AppPopupHelper {
  static final Set<String> _dismissedPopupIds = {};

  /// Checks for active announcement popups for [target] ('player' | 'agent' | 'all')
  /// and displays the highest-priority active popup if not yet dismissed.
  static Future<void> checkAndShowPopup(
    BuildContext context, {
    required String target,
  }) async {
    try {
      final res = await ApiClient().dio.get(
        '/users/popups',
        queryParameters: {'target': target},
      );

      if (res.statusCode == 200 && res.data is List && (res.data as List).isNotEmpty) {
        final List popups = res.data as List;
        for (final p in popups) {
          final id = p['id']?.toString() ?? '';
          if (id.isEmpty || _dismissedPopupIds.contains(id)) continue;

          if (!context.mounted) return;

          // Mark as shown in current session
          _dismissedPopupIds.add(id);

          await showDialog(
            context: context,
            barrierDismissible: true,
            barrierColor: Colors.black.withOpacity(0.8),
            builder: (ctx) => _AppPopupDialog(popup: p as Map<String, dynamic>),
          );

          break; // Show at most one popup per check
        }
      }
    } catch (e) {
      debugPrint('[AppPopupHelper] Error fetching popups: $e');
    }
  }
}

class _AppPopupDialog extends StatelessWidget {
  final Map<String, dynamic> popup;

  const _AppPopupDialog({required this.popup});

  String _resolveImageUrl(String? url) {
    if (url == null || url.isEmpty) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    final base = AppConfig.apiBaseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    final path = url.startsWith('/') ? url : '/$url';
    return '$base$path';
  }

  void _handleButtonAction(BuildContext context, String? link) async {
    Navigator.of(context, rootNavigator: true).pop();
    if (link == null || link.trim().isEmpty) return;

    final trimmed = link.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      final uri = Uri.tryParse(trimmed);
      if (uri != null) {
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (e) {
          debugPrint('[AppPopup] Failed to launch url: $e');
        }
      }
    } else {
      // In-app navigation route
      try {
        if (context.mounted) {
          GoRouter.of(context).push(trimmed);
        }
      } catch (e) {
        debugPrint('[AppPopup] Route navigation error: $e');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = popup['title']?.toString() ?? '';
    final body = popup['body']?.toString() ?? '';
    final imageUrl = _resolveImageUrl(popup['image_url']?.toString());
    final buttonText = popup['button_text']?.toString() ?? '';
    final buttonLink = popup['button_link']?.toString() ?? '';

    return Dialog(
      backgroundColor: Colors.transparent,
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
      child: Stack(
        clipBehavior: Clip.none,
        alignment: Alignment.topRight,
        children: [
          Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxWidth: 380),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: const Color(0xFFF59E0B).withOpacity(0.55),
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFFF59E0B).withOpacity(0.2),
                  blurRadius: 24,
                  spreadRadius: 2,
                ),
                BoxShadow(
                  color: Colors.black.withOpacity(0.8),
                  blurRadius: 30,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 1. Popup Image Header
                if (imageUrl.isNotEmpty)
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
                    child: Image.network(
                      imageUrl,
                      height: 170,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                    ),
                  ),

                // 2. Content Padding Area
                Padding(
                  padding: const EdgeInsets.fromLTRB(22, 18, 22, 22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Title
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Color(0xFFFBBF24),
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 0.3,
                          height: 1.3,
                        ),
                      ),

                      if (body.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        Text(
                          body,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.85),
                            fontSize: 13.5,
                            fontWeight: FontWeight.w400,
                            height: 1.45,
                          ),
                        ),
                      ],

                      // CTA Button
                      if (buttonText.isNotEmpty) ...[
                        const SizedBox(height: 20),
                        Container(
                          width: double.infinity,
                          height: 46,
                          decoration: BoxDecoration(
                            gradient: const LinearGradient(
                              colors: [Color(0xFFF59E0B), Color(0xFFD97706)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFFF59E0B).withOpacity(0.4),
                                blurRadius: 12,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              borderRadius: BorderRadius.circular(12),
                              onTap: () => _handleButtonAction(context, buttonLink),
                              child: Center(
                                child: Text(
                                  buttonText,
                                  style: const TextStyle(
                                    color: Colors.black,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w800,
                                    letterSpacing: 0.5,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),

          // Close button in top-right
          Positioned(
            top: -12,
            right: -12,
            child: GestureDetector(
              onTap: () => Navigator.of(context, rootNavigator: true).pop(),
              child: Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: const Color(0xFFF59E0B).withOpacity(0.6),
                    width: 1.5,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.6),
                      blurRadius: 8,
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.close_rounded,
                  color: Color(0xFFFBBF24),
                  size: 20,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

