import 'package:flutter/material.dart';
import '../data/cricket_models.dart';
import 'match_details_screen.dart';

class LiveMatchCenterScreen extends StatelessWidget {
  final CricketMatch match;
  const LiveMatchCenterScreen({super.key, required this.match});

  @override
  Widget build(BuildContext context) {
    return MatchDetailsScreen(match: match);
  }
}
