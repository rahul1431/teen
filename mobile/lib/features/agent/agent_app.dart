import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'agent_theme.dart';
import 'screens/agent_login_screen.dart';

class JokerAgentApp extends StatelessWidget {
  const JokerAgentApp({super.key});

  @override
  Widget build(BuildContext context) {
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: AgentTheme.background,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
    );

    return MaterialApp(
      title: 'MyOnlineJoker Agent Partner',
      debugShowCheckedModeBanner: false,
      theme: AgentTheme.themeData,
      home: const AgentLoginScreen(),
    );
  }
}

