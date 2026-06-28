// mobile/lib/core/monitor/monitor_interceptor.dart
import 'package:dio/dio.dart';
import 'monitor_service.dart';

/// Dio interceptor that records API call timing and errors.
/// Never logs request/response bodies or query string parameters (PII risk).
class MonitorInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    // Store start time in extra map — retrieved in onResponse/onError
    options.extra['_monitor_start'] = DateTime.now().millisecondsSinceEpoch;
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    _record(
      options: response.requestOptions,
      statusCode: response.statusCode ?? 0,
      errorMessage: null,
    );
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    _record(
      options: err.requestOptions,
      statusCode: err.response?.statusCode ?? 0,
      errorMessage: err.message != null
          ? err.message!.substring(0, err.message!.length.clamp(0, 200))
          : null,
    );
    handler.next(err);
  }

  void _record({
    required RequestOptions options,
    required int statusCode,
    String? errorMessage,
  }) {
    try {
      final start = options.extra['_monitor_start'] as int?;
      final durationMs = start != null
          ? DateTime.now().millisecondsSinceEpoch - start
          : null;

      // Use path only — never include query string (may contain tokens/phone numbers)
      final endpoint = options.uri.path;

      MonitorService.instance.enqueue({
        'event_type': 'api_call',
        'screen': MonitorService.instance.currentScreen,
        'endpoint': endpoint,
        'method': options.method,
        'status_code': statusCode,
        if (durationMs != null) 'duration_ms': durationMs,
        if (errorMessage != null) 'error_message': errorMessage,
      });
    } catch (_) {}
  }
}
