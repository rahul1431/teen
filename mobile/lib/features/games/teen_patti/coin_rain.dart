import 'dart:math';
import 'package:flutter/material.dart';

class CoinParticle {
  double x;
  double y;
  double vx;
  double vy;
  double angle;
  double angularVelocity;
  double scaleX; // for 3D spin simulation
  double size;
  double elasticity;
  int bounces;
  int maxBounces;
  double opacity;

  CoinParticle({
    required this.x,
    required this.y,
    required this.vx,
    required this.vy,
    required this.angle,
    required this.angularVelocity,
    required this.size,
    required this.elasticity,
    required this.maxBounces,
  }) : scaleX = 1.0,
       bounces = 0,
       opacity = 1.0;

  void update(double dt, double width, double height, double gravity) {
    // Apply gravity
    vy += gravity * dt;
    x += vx * dt;
    y += vy * dt;
    angle += angularVelocity * dt;

    // Simulate 3D rotation by oscillating scaleX
    scaleX = sin(angle).abs();

    // Friction / drag
    vx *= 0.99;

    // Bounce off walls
    if (x < 0) {
      x = 0;
      vx = -vx * 0.8;
    } else if (x > width) {
      x = width;
      vx = -vx * 0.8;
    }

    // Bounce off bottom boundary (e.g. action bar area at 80% height)
    double bottomBoundary = height * 0.85;
    if (y > bottomBoundary) {
      if (bounces < maxBounces) {
        y = bottomBoundary;
        vy = -vy * elasticity;
        vx *= 0.8; // Lose speed on bounce
        bounces++;
      } else {
        // Fade out after max bounces
        opacity -= 0.02;
        if (opacity < 0) opacity = 0;
      }
    }
  }
}

class CoinRainWidget extends StatefulWidget {
  final bool active;
  const CoinRainWidget({super.key, required this.active});

  @override
  State<CoinRainWidget> createState() => _CoinRainWidgetState();
}

class _CoinRainWidgetState extends State<CoinRainWidget> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  final List<CoinParticle> _particles = [];
  final Random _random = Random();
  double _width = 0;
  double _height = 0;
  
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 5),
    )..addListener(_tick);
    
    if (widget.active) {
      _startRain();
    }
  }

  @override
  void didUpdateWidget(CoinRainWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.active && !oldWidget.active) {
      _startRain();
    } else if (!widget.active && oldWidget.active) {
      _stopRain();
    }
  }

  void _startRain() {
    _particles.clear();
    _controller.repeat();
  }

  void _stopRain() {
    _controller.stop();
    setState(() {
      _particles.clear();
    });
  }

  void _tick() {
    if (_width == 0 || _height == 0) return;

    // Spawn new coins at top of screen occasionally
    if (_particles.length < 60 && _random.nextDouble() < 0.3) {
      _particles.add(CoinParticle(
        x: _random.nextDouble() * _width,
        y: -20,
        vx: (_random.nextDouble() - 0.5) * 200, // horizontal velocity
        vy: _random.nextDouble() * 150 + 100,  // initial downward velocity
        angle: _random.nextDouble() * pi * 2,
        angularVelocity: (_random.nextDouble() - 0.5) * 15,
        size: _random.nextDouble() * 12 + 10,  // size between 10 and 22
        elasticity: _random.nextDouble() * 0.2 + 0.5, // 0.5 to 0.7
        maxBounces: _random.nextInt(3) + 2,    // 2 to 4 bounces
      ));
    }

    setState(() {
      for (int i = _particles.length - 1; i >= 0; i--) {
        final p = _particles[i];
        p.update(0.016, _width, _height, 450.0); // 450 gravity
        if (p.opacity <= 0 || p.y > _height) {
          _particles.removeAt(i);
        }
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.active) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, constraints) {
        _width = constraints.maxWidth;
        _height = constraints.maxHeight;
        return CustomPaint(
          size: Size.infinite,
          painter: CoinRainPainter(particles: _particles),
        );
      },
    );
  }
}

class CoinRainPainter extends CustomPainter {
  final List<CoinParticle> particles;
  CoinRainPainter({required this.particles});

  @override
  void paint(Canvas canvas, Size size) {
    for (final p in particles) {
      if (p.opacity <= 0) continue;
      
      canvas.save();
      canvas.translate(p.x, p.y);
      canvas.rotate(p.angle);
      
      // Paint gold coin
      final paint = Paint()
        ..style = PaintingStyle.fill
        ..shader = RadialGradient(
          colors: [
            const Color(0xFFFFD700).withOpacity(p.opacity), // Gold
            const Color(0xFFDAA520).withOpacity(p.opacity), // GoldenRod
            const Color(0xFFB8860B).withOpacity(p.opacity), // DarkGoldenRod
          ],
          stops: const [0.0, 0.7, 1.0],
        ).createShader(Rect.fromCircle(center: Offset.zero, radius: p.size));

      final rimPaint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.0
        ..color = const Color(0xFFFFF8DC).withOpacity(p.opacity); // Cornsilk

      final innerPaint = Paint()
        ..style = PaintingStyle.fill
        ..color = const Color(0xFFB8860B).withOpacity(p.opacity * 0.6);

      // Distort for 3D rotation
      canvas.scale(p.scaleX, 1.0);

      // Draw outer circle
      canvas.drawCircle(Offset.zero, p.size, paint);
      // Draw rim
      canvas.drawCircle(Offset.zero, p.size, rimPaint);
      
      // Draw inner detail
      canvas.drawCircle(Offset.zero, p.size * 0.7, innerPaint);
      
      // Draw rupee sign (₹) or star in the center
      final textPainter = TextPainter(
        text: TextSpan(
          text: '₹',
          style: TextStyle(
            color: const Color(0xFFFFF8DC).withOpacity(p.opacity),
            fontSize: p.size * 0.9,
            fontWeight: FontWeight.bold,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      
      textPainter.paint(
        canvas,
        Offset(-textPainter.width / 2, -textPainter.height / 2),
      );

      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant CoinRainPainter oldDelegate) => true;
}
