import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:go_router/go_router.dart';
import '../../core/constants/app_config.dart';
import '../../core/network/api_client.dart';

class AppPopupHelper {
  static final Set<String> _dismissedPopupIds = {};

  /// Checks for active announcement popups for [target] ('player' | 'agent' | 'all')
  /// filtered by optional [page] ('home', 'wallet', 'games', 'agent_dashboard', etc.)
  /// Automatically waits for the popup's configured [delay_seconds] before rendering.
  static Future<void> checkAndShowPopup(
    BuildContext context, {
    required String target,
    String page = 'all',
  }) async {
    try {
      // Use public /api/popups/active or /api/users/popups which are verified on Nginx
      final res = await ApiClient().dio.get(
        '/api/users/popups',
        queryParameters: {
          'target': target,
        },
      );

      if (res.statusCode == 200 && res.data is List && (res.data as List).isNotEmpty) {
        final List popups = res.data as List;
        for (final item in popups) {
          if (item is! Map) continue;
          final p = Map<String, dynamic>.from(item);
          final id = p['id']?.toString() ?? '';
          if (id.isEmpty || _dismissedPopupIds.contains(id)) continue;

          // Check target_page filter: match 'all' or exact screen name
          final targetPage = (p['target_page']?.toString() ?? 'all').toLowerCase();
          if (targetPage != 'all' && page != 'all' && targetPage != page.toLowerCase()) {
            continue;
          }

          if (!context.mounted) return;

          // Get configured delay_seconds (default 2s)
          final delaySec = int.tryParse(p['delay_seconds']?.toString() ?? '') ?? 2;
          if (delaySec > 0) {
            await Future.delayed(Duration(seconds: delaySec));
          }

          if (!context.mounted) return;

          // Mark as shown in current session
          _dismissedPopupIds.add(id);

          await showDialog(
            context: context,
            barrierDismissible: true,
            barrierColor: Colors.black.withOpacity(0.8),
            builder: (ctx) => _AppPopupDialog(popup: p),
          );

          break; // Show at most one popup per screen load
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

  void _handleButtonAction(BuildContext context, String? link, String? actionType) async {
    Navigator.of(context, rootNavigator: true).pop();

    if (actionType == 'close') return;

    if (link == null || link.trim().isEmpty) return;
    final trimmed = link.trim();

    if (actionType == 'external_link' || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      final uri = Uri.tryParse(trimmed);
      if (uri != null) {
        try {
          await launchUrl(uri, mode: LaunchMode.externalApplication);
        } catch (e) {
          debugPrint('[AppPopup] Failed to launch url: $e');
        }
      }
      return;
    }

    // In-app navigation route (e.g. /deposit, /games/teen-patti, /missions, etc.)
    try {
      if (context.mounted) {
        GoRouter.of(context).push(trimmed);
      }
    } catch (e) {
      debugPrint('[AppPopup] Route navigation error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = popup['title']?.toString() ?? '';
    final body = popup['body']?.toString() ?? '';
    final imageUrl = _resolveImageUrl(popup['image_url']?.toString());
    final buttonText = popup['button_text']?.toString() ?? '';
    final buttonLink = popup['button_link']?.toString() ?? '';
    final actionType = popup['action_type']?.toString() ?? 'navigate';

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
                              onTap: () => _handleButtonAction(context, buttonLink, actionType),
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
