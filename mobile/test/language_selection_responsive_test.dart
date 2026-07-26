import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:myonlinejoker/features/onboarding/language_selection_page.dart';

/// Regression test: the onboarding language picker must render without
/// overflow on small screens (header + 5 language cards + Continue button
/// exceed short viewports unless the list scrolls).
void main() {
  Future<void> pumpAt(WidgetTester tester, Size logicalSize) async {
    tester.view.physicalSize = logicalSize;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(const MaterialApp(
      home: LanguageSelectionPage(isOnboarding: true),
    ));
    await tester.pump();
  }

  const sizes = <String, Size>{
    'tiny (320x533)': Size(320, 533),
    'small (360x640)': Size(360, 640),
    'medium (393x731)': Size(393, 731),
    'tall (412x915)': Size(412, 915),
  };

  for (final entry in sizes.entries) {
    testWidgets('renders without overflow on ${entry.key}', (tester) async {
      await pumpAt(tester, entry.value);
      expect(tester.takeException(), isNull);
      // Continue button must be present and on-screen.
      final button = find.byType(ElevatedButton);
      expect(button, findsOneWidget);
      final rect = tester.getRect(button);
      expect(rect.bottom, lessThanOrEqualTo(entry.value.height));
    });
  }

  testWidgets('all languages reachable by scrolling on tiny screens',
      (tester) async {
    await pumpAt(tester, const Size(320, 533));
    // Last language (Marathi) must be reachable.
    final marathi = find.text('मराठी');
    await tester.scrollUntilVisible(marathi, 100,
        scrollable: find.byType(Scrollable).first);
    expect(tester.takeException(), isNull);
  });
}
