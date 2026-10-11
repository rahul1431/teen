import 'package:flutter/material.dart';

class SportHelper {
  static String getCategory(String format) {
    final f = format.toLowerCase();
    if (f.contains('cricket') || f == 't20' || f == 'odi' || f == 'test' || f == 'ipl') return 'Cricket';
    if (f.contains('soccer')) return 'Soccer';
    if (f.contains('americanfootball')) return 'American Football';
    if (f.contains('basketball')) return 'Basketball';
    if (f.contains('baseball')) return 'Baseball';
    if (f.contains('icehockey')) return 'Ice Hockey';
    if (f.contains('mma') || f.contains('boxing')) return 'Combat Sports';
    if (f.contains('handball')) return 'Handball';
    if (f.contains('rugby')) return 'Rugby';
    if (f.contains('aussierules')) return 'Aussie Rules';
    if (f.contains('lacrosse')) return 'Lacrosse';
    return 'Other Sports';
  }

  static String getIcon(String category) {
    switch (category) {
      case 'Cricket': return '🏏';
      case 'Soccer': return '⚽';
      case 'American Football': return '🏈';
      case 'Basketball': return '🏀';
      case 'Baseball': return '⚾';
      case 'Ice Hockey': return '🏒';
      case 'Combat Sports': return '🥊';
      case 'Handball': return '🤾';
      case 'Rugby': return '🏉';
      case 'Aussie Rules': return '🏉';
      case 'Lacrosse': return '🥍';
      default: return '🏆';
    }
  }

  static List<Color> getGradient(String category) {
    switch (category) {
      case 'Cricket': return [const Color(0xFF0F3025), const Color(0xFF1E5631)];
      case 'Soccer': return [const Color(0xFF0F172A), const Color(0xFF1E3A8A)];
      case 'American Football': return [const Color(0xFF450A0A), const Color(0xFF7F1D1D)];
      case 'Basketball': return [const Color(0xFF7C2D12), const Color(0xFF9A3412)];
      case 'Baseball': return [const Color(0xFF115E59), const Color(0xFF14B8A6)];
      case 'Ice Hockey': return [const Color(0xFF1E3A8A), const Color(0xFF3B82F6)];
      case 'Combat Sports': return [const Color(0xFF3F0712), const Color(0xFF881337)];
      default: return [const Color(0xFF1F2937), const Color(0xFF4B5563)];
    }
  }
}
