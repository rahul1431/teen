# Lottery Four-Section Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `category` (`daily | instant | weekly | monthly`) on every lottery draw, let admins tag `weekly`/`monthly` draws (the only categories with a working mechanic today), and reorganize the mobile Lottery page into four category browsing sections plus the existing My Tickets/Results tabs.

**Architecture:** Same three-layer structure already used throughout this app (Postgres → Fastify `core-api-service`/`admin-service` → React admin panel / Flutter mobile app). No new services, no new game mechanic, no new settlement logic — this is a categorization and navigation layer on top of the already-shipped Dedicated Number mode. `daily`/`instant` categories are modeled now (so no second migration is needed later) but are not creatable yet — they're reserved for the future Card/Bingo and Scratch Card mechanics.

**Tech Stack:** PostgreSQL, Fastify + Zod + node-postgres (`core-api-service`, `admin-service`), React + antd (`admin-panel`), Flutter/Dart (`mobile`).

## Global Constraints

- Every `lottery_draws` row has a `category` of exactly one of: `'daily'`, `'instant'`, `'weekly'`, `'monthly'` — enforced by a `CHECK` constraint, `NOT NULL`.
- Only `'weekly'` and `'monthly'` are creatable today. The admin Create Draw form must render `Daily`/`Instant` as visibly disabled ("Coming Soon"), and the backend's create schema must accept all four values (so the `CHECK` constraint doesn't need to change again when Daily/Instant ship) even though only weekly/monthly reach it in practice from the current UI.
- No new game mechanic, no changes to ticket price / prize tier configuration / buy flow / settlement — all of that is unchanged from the shipped Dedicated Number mode.
- No auto-recurring draw creation — admin creates every draw manually, exactly as today, just with a category tag.
- `My Tickets` and `Results` on mobile stay single flat lists spanning all categories (not four separate lists) — each row shows its category as a small tag.
- The mobile header's jackpot total and next-draw countdown are scoped to whichever category section is currently active (not aggregated across all four).
- Verify each task by compiling (`npx tsc --noEmit` / `dart analyze`) and, where noted, direct `psql`/`curl` checks — this codebase has no automated test runner for these betting features; that's the established verification pattern here, follow it rather than introducing a new one.
- Design reference: `docs/superpowers/specs/2026-07-14-lottery-four-sections-design.md`.

---

### Task 1: Database migration — add `category` column

**Files:**
- Create: `infra/db/migrations/073_lottery_categories.sql`

**Interfaces:**
- Produces: `lottery_draws.category` (`VARCHAR(16) NOT NULL`, `CHECK (category IN ('daily','instant','weekly','monthly'))`) — every later task depends on this exact column name, type, and allowed values.

- [ ] **Step 1: Write the migration file**

```sql
-- Lottery four-section reorganization: tag every draw with a category so
-- the mobile app can split draws into Daily/Instant/Weekly/Monthly
-- sections. Daily and Instant are modeled now (so this CHECK constraint
-- never needs to change again) but aren't creatable yet — those two
-- mechanics (Card/Bingo, Scratch Card) don't exist yet. Only Weekly and
-- Monthly reuse the already-shipped Dedicated Number mechanic.
--
-- Uses the add-nullable -> backfill -> set-not-null sequence rather than
-- a plain `ADD COLUMN ... NOT NULL` because it's safe regardless of
-- whether any draws already exist in the target database at run time.
BEGIN;

ALTER TABLE lottery_draws ADD COLUMN category VARCHAR(16);
UPDATE lottery_draws SET category = 'weekly' WHERE category IS NULL;
ALTER TABLE lottery_draws ALTER COLUMN category SET NOT NULL;
ALTER TABLE lottery_draws ADD CONSTRAINT lottery_draws_category_check
  CHECK (category IN ('daily', 'instant', 'weekly', 'monthly'));

COMMIT;
```

- [ ] **Step 2: Verify the migration is well-formed**

This environment has no local Postgres — static review only (no `psql` available locally). Confirm:
- The file starts with `BEGIN;` and ends with `COMMIT;`.
- Column name is exactly `category`, type `VARCHAR(16)`.
- The `UPDATE` runs before the `SET NOT NULL`, so it works whether the table has 0 rows or existing rows.
- The `CHECK` constraint lists exactly the four values from Global Constraints, single-quoted, comma-separated.

Full execution against the live database happens in Task 5 (VPS deployment), same pattern as the prior lottery migration.

- [ ] **Step 3: Commit**

```bash
git add infra/db/migrations/073_lottery_categories.sql
git commit -m "feat(lottery): add category column (daily/instant/weekly/monthly)"
```

---

### Task 2: Backend — accept and surface `category`

**Files:**
- Modify: `services/core-api-service/src/plugins/betting.ts:392-404` (`/internal/lottery/create`), `services/core-api-service/src/plugins/betting.ts:160-163` (`/lottery/my-tickets`)

**Interfaces:**
- Consumes: `lottery_draws.category` (VARCHAR(16)) from Task 1.
- Produces: `/internal/lottery/create` now requires a `category` field in its request body — Task 4's admin panel form and Task 5's verification curl calls depend on sending it. `/lottery/my-tickets` responses now include a `draw_category` field per ticket — Task 3's mobile ticket row depends on this exact field name.

- [ ] **Step 1: Add `category` to the create-draw schema and insert**

Find (in `services/core-api-service/src/plugins/betting.ts`):

```ts
    app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        name: z.string(),
        ticket_price: z.number().positive(),
        draw_time: z.string(),
        prize_tiers: z.array(z.object({
          match_type: z.enum(['exact', 'last_3', 'last_2', 'last_1']),
          multiplier: z.number().positive(),
        })).min(1),
      }).parse(req.body)
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers) VALUES ($1,$2,$3,$4) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers)])
      return { success: true, draw: r.rows[0] }
    })
```

Replace with:

```ts
    app.post('/internal/lottery/create', { onRequest: [internal] }, async (req) => {
      const body = z.object({
        name: z.string(),
        ticket_price: z.number().positive(),
        draw_time: z.string(),
        prize_tiers: z.array(z.object({
          match_type: z.enum(['exact', 'last_3', 'last_2', 'last_1']),
          multiplier: z.number().positive(),
        })).min(1),
        category: z.enum(['daily', 'instant', 'weekly', 'monthly']),
      }).parse(req.body)
      const r = await db.query(`INSERT INTO lottery_draws (name, ticket_price, draw_time, prize_tiers, category) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [body.name, body.ticket_price, body.draw_time, JSON.stringify(body.prize_tiers), body.category])
      return { success: true, draw: r.rows[0] }
    })
```

- [ ] **Step 2: Add `draw_category` to the my-tickets query**

Find:

```ts
    app.get('/lottery/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(`SELECT t.*, d.name AS draw_name, d.winning_number, d.draw_time, d.status AS draw_status FROM lottery_tickets t JOIN lottery_draws d ON d.id = t.draw_id WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [uid(req)])
      return { tickets: rows.rows }
    })
```

Replace with:

```ts
    app.get('/lottery/my-tickets', { onRequest: [auth] }, async (req) => {
      const rows = await db.query(`SELECT t.*, d.name AS draw_name, d.winning_number, d.draw_time, d.status AS draw_status, d.category AS draw_category FROM lottery_tickets t JOIN lottery_draws d ON d.id = t.draw_id WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [uid(req)])
      return { tickets: rows.rows }
    })
```

- [ ] **Step 3: Confirm `/lottery/draws` and `/lottery/results` need no code change**

Both already `SELECT d.*` (lines 120 and 166), so `category` is automatically included in their responses once Task 1's migration runs — no edit needed there. Read both blocks to confirm this is still true (grep for `SELECT d\.\*` in the file) before moving on; if either has since changed to an explicit column list, add `d.category` to it.

- [ ] **Step 4: Verify it compiles**

Run: `cd services/core-api-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add services/core-api-service/src/plugins/betting.ts
git commit -m "feat(lottery): accept category on create, surface draw_category on tickets"
```

---

### Task 3: Admin panel — Category field on Create Draw + table column

**Files:**
- Modify: `admin-panel/src/pages/games/Lottery.tsx:85-99` (`create` function), `admin-panel/src/pages/games/Lottery.tsx:465-516` (Create Draw form), `admin-panel/src/pages/games/Lottery.tsx:347-449` (draws table columns)

**Interfaces:**
- Consumes: `/internal/lottery/create` now requires `category` (Task 2).
- Produces: none consumed by later tasks — this task is self-contained.

- [ ] **Step 1: Send `category` in the create request**

Find (in `admin-panel/src/pages/games/Lottery.tsx`):

```tsx
  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
      })
```

Replace with:

```tsx
  const create = async (v: any) => {
    try {
      await adminApi.post('/betting/lottery/create', {
        name: v.name, ticket_price: v.ticket_price,
        prize_tiers: v.prize_tiers, draw_time: v.draw_time.toISOString(),
        category: v.category,
      })
```

- [ ] **Step 2: Add the Category field to the Create Draw form**

Find (the last `Form.Item` in the Create Draw `Form`, right before its closing `</Form>`):

```tsx
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
        </Form>
      </Modal>
```

Replace with:

```tsx
          <Form.Item name="draw_time" label="Draw Time" rules={[{ required: true, message: 'Please select draw time' }]}>
            <DatePicker showTime style={{ width: '100%', borderRadius: '6px' }} />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true, message: 'Please select a category' }]} initialValue="weekly">
            <Radio.Group>
              <Radio.Button value="daily" disabled>Daily 🔜</Radio.Button>
              <Radio.Button value="instant" disabled>Instant 🔜</Radio.Button>
              <Radio.Button value="weekly">Weekly</Radio.Button>
              <Radio.Button value="monthly">Monthly</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
```

- [ ] **Step 3: Add a Category column to the draws table**

Find (the `Prize Tiers` column definition, immediately followed by the `Sold` column):

```tsx
                {
                  title: 'Prize Tiers',
                  dataIndex: 'prize_tiers',
                  render: (tiers: any[]) => (
                    <Space wrap size={4}>
                      {(tiers || []).map((t, i) => (
                        <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                          {t.match_type === 'exact' ? '4/4' : t.match_type.replace('last_', 'Last ')}: {t.multiplier}x
                        </Tag>
                      ))}
                    </Space>
                  )
                },
                { 
                  title: 'Sold', 
                  dataIndex: 'ticket_count',
                  render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span>
                },
```

Replace with:

```tsx
                {
                  title: 'Prize Tiers',
                  dataIndex: 'prize_tiers',
                  render: (tiers: any[]) => (
                    <Space wrap size={4}>
                      {(tiers || []).map((t, i) => (
                        <Tag key={i} color="gold" style={{ fontWeight: 'bold', fontSize: 10 }}>
                          {t.match_type === 'exact' ? '4/4' : t.match_type.replace('last_', 'Last ')}: {t.multiplier}x
                        </Tag>
                      ))}
                    </Space>
                  )
                },
                {
                  title: 'Category',
                  dataIndex: 'category',
                  render: (c: string) => {
                    const colors: Record<string, string> = { daily: 'cyan', instant: 'purple', weekly: 'blue', monthly: 'gold' }
                    return <Tag color={colors[c] || 'default'} style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>{c}</Tag>
                  }
                },
                { 
                  title: 'Sold', 
                  dataIndex: 'ticket_count',
                  render: (v) => <span style={{ fontWeight: 'bold' }}>{v || 0}</span>
                },
```

- [ ] **Step 4: Verify it compiles**

Run: `cd admin-panel && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/games/Lottery.tsx
git commit -m "feat(lottery-admin): category field on Create Draw + table column"
```

---

### Task 4: Mobile — four-section tab structure

**Files:**
- Modify: `mobile/lib/features/games/betting/lottery_page.dart` (state fields/`initState`/`dispose` around lines 18-49, `_totalJackpot`/`_nextDraw` getters around lines 92-111, `_buildSliverAppBar`'s `TabBar` around lines 196-210, `_drawsTab`/`_drawCard` region starting line 330, `_ticketRow` around lines 680-748, `_resultCard` around lines 885-936)

**Interfaces:**
- Consumes: `draw['category']` (from `/lottery/draws`, `/lottery/results` — Task 2's confirmation that these already include it), `ticket['draw_category']` (from `/lottery/my-tickets` — Task 2 Step 2).
- Produces: none — this is the final task before VPS verification.

**IMPORTANT — scope discipline:** This file was previously the subject of a scope incident where an implementer's auto-formatter reformatted ~900 unrelated lines. Edit ONLY the specific methods and regions named below. Do not run `dart format` or any other whole-file formatter. Every "Find/Replace" block below shows enough surrounding context to locate its unique position — match on that exact text, do not touch code outside each block.

- [ ] **Step 1: Add a `_categories` list and per-category draw filtering; update tab controller length**

Find:

```dart
class _LotteryPageState extends State<LotteryPage> with TickerProviderStateMixin {
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  List<dynamic> _results = [];
  bool _loading = true;
  bool _myLoading = false;
  bool _resLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 3, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) {
        if (_tab.index == 1 && _myTickets.isEmpty) _loadMyTickets();
        if (_tab.index == 2 && _results.isEmpty) _loadResults();
      }
    });
    _loadDraws();
    _loadBalance();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }
```

Replace with:

```dart
class _LotteryPageState extends State<LotteryPage> with TickerProviderStateMixin {
  static const _categories = ['daily', 'instant', 'weekly', 'monthly'];
  late final TabController _tab;
  List<dynamic> _draws = [];
  List<dynamic> _myTickets = [];
  List<dynamic> _results = [];
  bool _loading = true;
  bool _myLoading = false;
  bool _resLoading = false;
  double _balance = 0;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _tab = TabController(length: 6, vsync: this);
    _tab.addListener(() {
      if (!_tab.indexIsChanging) {
        setState(() {});
        if (_tab.index == 4 && _myTickets.isEmpty) _loadMyTickets();
        if (_tab.index == 5 && _results.isEmpty) _loadResults();
      }
    });
    _loadDraws();
    _loadBalance();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) { if (mounted) setState(() {}); });
  }

  List<dynamic> _drawsFor(String category) =>
      _draws.where((d) => d['category'] == category).toList();

  String get _activeCategory =>
      _categories[_tab.index.clamp(0, _categories.length - 1)];
```

- [ ] **Step 2: Scope the jackpot/countdown getters to `_activeCategory`**

Find:

```dart
  double get _totalJackpot => _draws.fold(0.0, (sum, d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final tiers = (d['prize_tiers'] as List?) ?? [];
    final exactTier = tiers.cast<Map>().firstWhere(
          (t) => t['match_type'] == 'exact',
          orElse: () => {},
        );
    final mult = double.tryParse(exactTier['multiplier']?.toString() ?? '0') ?? 0;
    return sum + price * mult;
  });

  DateTime? get _nextDraw {
    final times = _draws
        .map((d) => DateTime.tryParse(d['draw_time']?.toString() ?? ''))
        .whereType<DateTime>()
        .where((t) => t.isAfter(DateTime.now()))
        .toList()
      ..sort();
    return times.isEmpty ? null : times.first;
  }
```

Replace with:

```dart
  double get _totalJackpot => _drawsFor(_activeCategory).fold(0.0, (sum, d) {
    final price = double.tryParse(d['ticket_price']?.toString() ?? '0') ?? 0;
    final tiers = (d['prize_tiers'] as List?) ?? [];
    final exactTier = tiers.cast<Map>().firstWhere(
          (t) => t['match_type'] == 'exact',
          orElse: () => {},
        );
    final mult = double.tryParse(exactTier['multiplier']?.toString() ?? '0') ?? 0;
    return sum + price * mult;
  });

  DateTime? get _nextDraw {
    final times = _drawsFor(_activeCategory)
        .map((d) => DateTime.tryParse(d['draw_time']?.toString() ?? ''))
        .whereType<DateTime>()
        .where((t) => t.isAfter(DateTime.now()))
        .toList()
      ..sort();
    return times.isEmpty ? null : times.first;
  }
```

- [ ] **Step 3: Update the TabBar labels and TabBarView children**

Find:

```dart
          child: TabBar(
            controller: _tab,
            indicatorColor: AppColors.gold,
            indicatorWeight: 3.0,
            labelColor: AppColors.gold,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5),
            tabs: const [Tab(text: 'Active Draws'), Tab(text: 'My Tickets'), Tab(text: 'Results')],
          ),
```

Replace with:

```dart
          child: TabBar(
            controller: _tab,
            isScrollable: true,
            indicatorColor: AppColors.gold,
            indicatorWeight: 3.0,
            labelColor: AppColors.gold,
            unselectedLabelColor: AppColors.textSecondary,
            labelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13, letterSpacing: 0.5),
            tabs: const [
              Tab(text: 'Daily'),
              Tab(text: 'Instant'),
              Tab(text: 'Weekly'),
              Tab(text: 'Monthly'),
              Tab(text: 'My Tickets'),
              Tab(text: 'Results'),
            ],
          ),
```

Find (the `TabBarView` in `build()`):

```dart
        body: TabBarView(
          controller: _tab,
          children: [_drawsTab(), _myTicketsTab(), _resultsTab()],
        ),
```

Replace with:

```dart
        body: TabBarView(
          controller: _tab,
          children: [
            _categoryDrawsTab('daily'),
            _categoryDrawsTab('instant'),
            _categoryDrawsTab('weekly'),
            _categoryDrawsTab('monthly'),
            _myTicketsTab(),
            _resultsTab(),
          ],
        ),
```

- [ ] **Step 4: Replace `_drawsTab()` with `_categoryDrawsTab(String category)` + a Coming Soon placeholder**

Find (the entire `_drawsTab` method — locate by its `// ── Tab 1: Active Draws` comment marker directly above it):

```dart
  // ── Tab 1: Active Draws ─────────────────────────────────────────────────

  Widget _drawsTab() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    if (_draws.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.confirmation_num_outlined,
                size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
            const SizedBox(height: 18),
            const Text('No draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Check back soon for new jackpots',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.45), fontSize: 12)),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: _loadDraws,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.gold,
                side: BorderSide(color: AppColors.gold.withOpacity(0.35)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: _draws.length,
        itemBuilder: (_, i) => _drawCard(_draws[i]),
      ),
    );
  }
```

Replace with:

```dart
  // ── Tabs 1-4: Category Draws ─────────────────────────────────────────────

  static const _categoryLabels = {
    'daily': 'Daily Lottery (Card/Bingo)',
    'instant': 'Instant Lottery (Scratch Card)',
  };

  Widget _categoryDrawsTab(String category) {
    if (_categoryLabels.containsKey(category)) {
      return _comingSoonTab(_categoryLabels[category]!);
    }
    if (_loading) return const Center(child: CircularProgressIndicator(color: AppColors.gold));
    final draws = _drawsFor(category);
    if (draws.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.confirmation_num_outlined,
                size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
            const SizedBox(height: 18),
            const Text('No draws open right now',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Check back soon for new jackpots',
                style: TextStyle(color: AppColors.textSecondary.withOpacity(0.45), fontSize: 12)),
            const SizedBox(height: 24),
            TextButton.icon(
              onPressed: _loadDraws,
              icon: const Icon(Icons.refresh_rounded, size: 16),
              label: const Text('Refresh'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.gold,
                side: BorderSide(color: AppColors.gold.withOpacity(0.35)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)
              ),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _loadDraws,
      color: AppColors.gold,
      backgroundColor: AppColors.cardBg,
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
        itemCount: draws.length,
        itemBuilder: (_, i) => _drawCard(draws[i]),
      ),
    );
  }

  Widget _comingSoonTab(String label) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.hourglass_empty_rounded,
              size: 64, color: AppColors.textSecondary.withOpacity(0.2)),
          const SizedBox(height: 18),
          Text('$label',
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 15, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('This game mode is coming soon',
              style: TextStyle(color: AppColors.textSecondary.withOpacity(0.45), fontSize: 12)),
        ],
      ),
    );
  }
```

- [ ] **Step 5: Add a small category tag helper**

Find (immediately above the `_ticketRow` method — locate by the `Widget _ticketRow(dynamic t) {` signature):

```dart
  Widget _ticketRow(dynamic t) {
```

Replace with:

```dart
  static const _categoryTagColors = {
    'daily': Colors.cyanAccent,
    'instant': Colors.purpleAccent,
    'weekly': Colors.lightBlueAccent,
    'monthly': AppColors.gold,
  };

  Widget _categoryTag(String? category) {
    if (category == null) return const SizedBox.shrink();
    final color = _categoryTagColors[category] ?? AppColors.textSecondary;
    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Text(
        category[0].toUpperCase() + category.substring(1),
        style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w800),
      ),
    );
  }

  Widget _ticketRow(dynamic t) {
```

- [ ] **Step 6: Show the category tag in `_ticketRow`**

Find:

```dart
                    Row(
                      children: [
                        Expanded(
                          child: Text(t['draw_name'] ?? 'Lottery',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Colors.white)),
                        ),
                        _statusBadge(isWinner, isLoser, drawStatus),
                      ],
                    ),
```

Replace with:

```dart
                    Row(
                      children: [
                        Expanded(
                          child: Text(t['draw_name'] ?? 'Lottery',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5, color: Colors.white)),
                        ),
                        _categoryTag(t['draw_category']?.toString()),
                        const SizedBox(width: 6),
                        _statusBadge(isWinner, isLoser, drawStatus),
                      ],
                    ),
```

- [ ] **Step 7: Show the category tag in `_resultCard`**

Find:

```dart
                        Expanded(
                          child: Text(d['name'] ?? 'Lottery Draw',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: Colors.white)),
                        ),
```

Replace with:

```dart
                        Expanded(
                          child: Text(d['name'] ?? 'Lottery Draw',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 14.5, color: Colors.white)),
                        ),
                        _categoryTag(d['category']?.toString()),
```

- [ ] **Step 8: Verify it analyzes clean**

Run: `cd mobile && dart analyze lib/features/games/betting/lottery_page.dart`
Expected: `No issues found!`

Run: `cd mobile && dart analyze lib/`
Expected: only the same pre-existing unrelated warnings seen before this work started (the `withOpacity` deprecation infos in this file, and unrelated warnings in `ludo_game_page.dart`/`wallet_page.dart`/`location_consent_service.dart`). No NEW errors in `lottery_page.dart`.

- [ ] **Step 9: Confirm the diff is scoped correctly**

Run: `git diff --stat -- mobile/lib/features/games/betting/lottery_page.dart`
Expected: roughly 150-250 changed lines, all within the regions this task named (state fields, `_totalJackpot`/`_nextDraw`, the `TabBar`/`TabBarView`, `_drawsTab`→`_categoryDrawsTab`, `_ticketRow`, `_resultCard`). If the diff is much larger than that or touches unrelated methods (`_drawCard`, `_showTicketPicker`, the ticket picker sheet, etc.), STOP — do not commit — and re-derive the change from the Find/Replace blocks above instead.

- [ ] **Step 10: Commit**

```bash
git add mobile/lib/features/games/betting/lottery_page.dart
git commit -m "feat(lottery-mobile): four-section tabs (Daily/Instant/Weekly/Monthly)"
```

---

### Task 5: End-to-end verification against the live VPS

**Files:** none (deployment + manual verification only)

**Interfaces:** none — this task exercises the full stack built in Tasks 1-4.

- [ ] **Step 1: Push and pull onto the VPS**

Run locally: `git push origin feature/admin-responsive`
Run on VPS: `cd /opt/teen-prod && git status --short` — expect only the known pre-existing untracked files (`SERVICE_RESTART_FIX.md`, `ecosystem.dev.config.js`, `services/admin-service/src/index.ts.bak.*`).
Run on VPS: `git fetch origin && git reset --hard origin/feature/admin-responsive`

- [ ] **Step 2: Run the migration**

Run on VPS: `docker exec -i teen_postgres psql -U teen -d teen_db < /opt/teen-prod/infra/db/migrations/073_lottery_categories.sql`
Expected: `BEGIN`, `ALTER TABLE`, `UPDATE 0` (or a small number if any test rows exist), `ALTER TABLE`, `ALTER TABLE`, `COMMIT`.

- [ ] **Step 3: Rebuild and restart the backend, rebuild and redeploy the admin panel**

Run on VPS: `cd /opt/teen-prod/services/core-api-service && npm run build && pm2 restart teen-core-api`
Run on VPS: `cd /opt/teen-prod/admin-panel && npm install --no-audit --no-fund && VITE_API_BASE_URL='' npm run build -- --base=/admin/`
Run on VPS: `rm -rf /home/admin/web/game.myonlinejoker.com/public_html/admin/* && cp -r /opt/teen-prod/admin-panel/dist/* /home/admin/web/game.myonlinejoker.com/public_html/admin/ && chown -R admin:admin /home/admin/web/game.myonlinejoker.com/public_html/admin/`
Expected: build succeeds with no `tsc` errors, `teen-core-api` shows `online` in `pm2 status`.

- [ ] **Step 4: Verify health**

Run on VPS: `curl -s http://127.0.0.1:3001/health` — expect `{"status":"ok",...}`.
Run: `curl -s -o /dev/null -w '%{http_code}\n' https://game.myonlinejoker.com/admin/` — expect `200`.

- [ ] **Step 5: Create a weekly test draw and verify `category` persists**

```bash
curl -s -X POST http://127.0.0.1:3001/internal/lottery/create -H 'Content-Type: application/json' -H 'x-internal-key: <INTERNAL_SERVICE_KEY from services/core-api-service/.env>' -d '{"name":"Test Weekly","ticket_price":10,"draw_time":"2026-07-21T12:00:00Z","prize_tiers":[{"match_type":"exact","multiplier":5000}],"category":"weekly"}'
```
Expected: `{"success":true,"draw":{...,"category":"weekly",...}}`.

Repeat with `"category":"monthly"` for a second test draw.

Try an invalid category: `{"category":"daily", ...}` with the rest of the body otherwise valid — this should still succeed at the database layer (the `CHECK` constraint allows `daily`), confirming the schema is forward-compatible even though the UI doesn't expose it yet. Delete this one immediately after (see Step 8) since it's not a real category the product surfaces today.

- [ ] **Step 6: Verify `/lottery/draws` and `/lottery/my-tickets` surface category correctly**

Using a real user JWT (mint one via `jsonwebtoken` + the service's `JWT_SECRET`, same approach used in the prior lottery verification):

```bash
curl -s http://127.0.0.1:3001/lottery/draws -H 'Authorization: Bearer <token>'
```
Expected: both `Test Weekly` and the `monthly` test draw appear, each with its correct `category` field. The `daily`-tagged test draw does NOT appear (its `draw_time` should be far enough in the future to otherwise qualify — confirm it's excluded only if you deliberately set its status/time to not qualify, otherwise it's fine for it to appear here since `/lottery/draws` doesn't filter by category; category filtering happens client-side in the mobile app, per Task 4).

Buy one ticket against the `Test Weekly` draw, then:
```bash
curl -s http://127.0.0.1:3001/lottery/my-tickets -H 'Authorization: Bearer <token>'
```
Expected: the ticket's `draw_category` field is `"weekly"`.

- [ ] **Step 7: Verify the admin panel Create Draw form**

Manually (or describe for the user to confirm): open the admin panel Lottery page, click Create Draw, confirm the Category field shows all four options with Daily/Instant visibly disabled, and that submitting with Weekly or Monthly selected succeeds.

- [ ] **Step 8: Clean up all test draws**

```bash
docker exec -i teen_postgres psql -U teen -d teen_db -c "DELETE FROM lottery_tickets WHERE draw_id IN (SELECT id FROM lottery_draws WHERE name LIKE 'Test %'); DELETE FROM lottery_draws WHERE name LIKE 'Test %';"
```

- [ ] **Step 9: Build and hand off the mobile APK**

Run locally: `cd mobile && flutter build apk --release`
Expected: `√ Built build\app\outputs\flutter-apk\app-release.apk (...)`, no errors.

Report back to the user: migration ran clean, admin panel shows the Category field with Daily/Instant disabled, mobile app now shows six tabs (Daily/Instant/Weekly/Monthly/My Tickets/Results) with Daily/Instant showing a Coming Soon placeholder, and new draws correctly appear under Weekly/Monthly. Ask the user to install the new APK and confirm the tab layout and Coming Soon placeholders look right before considering this reorganization fully shipped.
