import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'features/agent/agent_app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Enforce portrait orientation for clean mobile agent operations
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  runApp(const JokerAgentApp());
}

