# Withdraw Locked to Verified Bank Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Withdrawals pay out only to the user's admin-verified saved bank account — no free-text UPI/bank entry on the withdraw screen, and the backend ignores/ rejects any client-supplied payout details.

**Architecture:** Backend (`wallet-service`) drops the `bank_account`/`upi_id` fields from the withdraw-request schema and instead reads the caller's `bank_details` row itself, 400ing if it's missing or unverified. Mobile (`_WithdrawSheet`) fetches that same row via the existing `GET /api/users/me/bank` endpoint and renders one of three states (no bank / pending / verified), only enabling submission in the verified state.

**Tech Stack:** Fastify + Zod + `pg` (wallet-service), Flutter/Dart + Dio (mobile).

## Global Constraints

- Single bank account per user — no schema/migration changes (`bank_details` stays one row per `user_id`).
- No new test framework is being introduced into `wallet-service` (it has none today — no `test` script, no test deps). Verification for the backend task is a TypeScript build check (`npx tsc --noEmit`) plus a documented manual curl walkthrough, matching how this service is already verified elsewhere in the codebase.
- Verification for the mobile task is `flutter analyze` — per established project convention, live/visual behavior is checked by the user on the deployed app themselves, not via Chrome automation.
- Minimum withdrawal amount (₹100), the KYC gate, and the 10 AM–9 PM withdrawal window are all unchanged.

---

### Task 1: Backend — enforce verified bank details on withdraw request

**Files:**
- Modify: `services/wallet-service/src/index.ts:456-511` (the `POST /wallet/withdraw/request` handler)

**Interfaces:**
- Consumes: existing `bank_details` table (columns: `holder_name`, `bank_name`, `account_number`, `ifsc_code`, `upi_id`, `verified`, keyed by `user_id`) — already used identically by `services/core-api-service/src/plugins/users.ts:226-234`.
- Produces: `POST /wallet/withdraw/request` now accepts only `{ amount: number }` in the body. On success it still returns `{ success: true, order_id, message }` (unchanged). On missing/unverified bank it returns `400 { error: 'Add and verify your bank details before withdrawing' }`. This is what Task 2's mobile client expects.

- [ ] **Step 1: Read the current handler to confirm line numbers**

Run: `grep -n "wallet/withdraw/request" -A 60 services/wallet-service/src/index.ts`

Expected: shows the handler starting at the `app.post('/wallet/withdraw/request', ...)` line, with the Zod schema containing `bank_account` and `upi_id`, and the `payment_orders` insert using `JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })`.

- [ ] **Step 2: Replace the schema and add the verified-bank lookup**

Replace:

```typescript
  app.post('/wallet/withdraw/request', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      amount: z.number().min(100).max(50000),
      bank_account: z.string().optional(),
      upi_id: z.string().optional(),
    }).parse(req.body)

    // KYC check first
    const kycRes = await db.query('SELECT kyc_status FROM users WHERE id = $1', [user.sub])
    if (kycRes.rows[0]?.kyc_status !== 'approved') {
      return reply.code(403).send({ error: 'KYC verification required before withdrawal' })
    }
```

With:

```typescript
  app.post('/wallet/withdraw/request', { onRequest: [authenticate] }, async (req, reply) => {
    const user = req.user as any
    const body = z.object({
      amount: z.number().min(100).max(50000),
    }).parse(req.body)

    // KYC check first
    const kycRes = await db.query('SELECT kyc_status FROM users WHERE id = $1', [user.sub])
    if (kycRes.rows[0]?.kyc_status !== 'approved') {
      return reply.code(403).send({ error: 'KYC verification required before withdrawal' })
    }

    // Payout destination must be the user's own admin-verified bank account —
    // never trust client-supplied account details for where money is sent.
    const bankRes = await db.query(
      `SELECT holder_name, bank_name, account_number, ifsc_code, upi_id, verified
       FROM bank_details WHERE user_id = $1`,
      [user.sub]
    )
    const bank = bankRes.rows[0]
    if (!bank || bank.verified !== true) {
      return reply.code(400).send({ error: 'Add and verify your bank details before withdrawing' })
    }
```

- [ ] **Step 3: Use the verified bank row in the stored order metadata**

Replace:

```typescript
      const orderRes = await client.query(
        `INSERT INTO payment_orders (user_id, gateway, amount, type, status, metadata)
         VALUES ($1, 'manual', $2, 'withdrawal', 'created', $3) RETURNING id`,
        [user.sub, body.amount, JSON.stringify({ bank_account: body.bank_account, upi_id: body.upi_id })]
      )
```

With:

```typescript
      const orderRes = await client.query(
        `INSERT INTO payment_orders (user_id, gateway, amount, type, status, metadata)
         VALUES ($1, 'manual', $2, 'withdrawal', 'created', $3) RETURNING id`,
        [user.sub, body.amount, JSON.stringify({
          holder_name: bank.holder_name,
          bank_name: bank.bank_name,
          account_number: bank.account_number,
          ifsc_code: bank.ifsc_code,
          upi_id: bank.upi_id,
        })]
      )
```

- [ ] **Step 4: Build check**

Run: `cd services/wallet-service && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification walkthrough (document, run against a real deployment)**

Record these curl checks (run by the user against the live/dev instance — this service has no automated test harness):

```bash
# 1. No/unverified bank on file -> 400 with the expected message
curl -s -X POST https://<host>/api/wallet/withdraw/request \
  -H "Authorization: Bearer <user_jwt>" -H "Content-Type: application/json" \
  -d '{"amount": 200}'
# Expect: 400 {"error":"Add and verify your bank details before withdrawing"}

# 2. Fabricated payout fields are ignored (send them anyway, confirm they don't appear in the stored order)
curl -s -X POST https://<host>/api/wallet/withdraw/request \
  -H "Authorization: Bearer <user_jwt>" -H "Content-Type: application/json" \
  -d '{"amount": 200, "bank_account": "999999999999", "upi_id": "attacker@upi"}'
# Expect: same 400 as above (schema no longer accepts these fields, they're silently dropped by Zod parse) — then, once admin verifies the user's real bank_details row, resubmitting the same amount succeeds and admin's view of the order shows the real verified account, not "999999999999".
```

- [ ] **Step 6: Commit**

```bash
git add services/wallet-service/src/index.ts
git commit -m "fix(wallet): withdraw payout locked to server-verified bank details"
```

---

### Task 2: Mobile — withdraw sheet uses saved verified bank account only

**Files:**
- Modify: `mobile/lib/features/wallet/wallet_page.dart:1-14` (imports)
- Modify: `mobile/lib/features/wallet/wallet_page.dart:840-1020` (`_WithdrawSheetState` — full rewrite of state fields, `initState`, `_submit`, and `build`)

**Interfaces:**
- Consumes: `GET /api/users/me/bank` → `{ bank: { holder_name, bank_name, account_number, ifsc_code, upi_id, verified, updated_at } | null }` (existing endpoint, `services/core-api-service/src/plugins/users.ts:226-234`, unchanged). `POST /api/wallet/withdraw/request` now takes `{ amount }` only and returns `400 { error }` when the bank isn't verified (Task 1).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the `BankDetailsPage` import**

Modify `mobile/lib/features/wallet/wallet_page.dart`, after the existing `kyc_page.dart` import:

```dart
import '../profile/kyc_page.dart';
import '../profile/bank_details_page.dart';
```

- [ ] **Step 2: Replace `_WithdrawSheetState` state fields and lifecycle**

Replace:

```dart
class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _amountCtrl = TextEditingController();
  final _upiCtrl = TextEditingController();
  final _bankCtrl = TextEditingController();
  bool _submitting = false;

  // Withdrawal window: 10 AM – 9 PM (device local time, UI-only gate).
  bool get _withdrawOpen {
    final h = DateTime.now().hour;
    return h >= 10 && h < 21;
  }
```

With:

```dart
class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _amountCtrl = TextEditingController();
  bool _submitting = false;
  bool _loadingBank = true;
  Map<String, dynamic>? _bank;

  bool get _bankVerified => _bank != null && _bank!['verified'] == true;

  // Withdrawal window: 10 AM – 9 PM (device local time, UI-only gate).
  bool get _withdrawOpen {
    final h = DateTime.now().hour;
    return h >= 10 && h < 21;
  }

  @override
  void initState() {
    super.initState();
    _loadBank();
  }

  Future<void> _loadBank() async {
    try {
      final res = await widget.api.dio.get('/api/users/me/bank');
      if (mounted) setState(() => _bank = res.data['bank'] as Map<String, dynamic>?);
    } catch (_) {
      if (mounted) setState(() => _bank = null);
    } finally {
      if (mounted) setState(() => _loadingBank = false);
    }
  }

  String _maskAccount(String acc) {
    if (acc.length <= 4) return acc;
    return '•' * (acc.length - 4) + acc.substring(acc.length - 4);
  }
```

- [ ] **Step 3: Simplify `_submit` to send only `amount`**

Replace:

```dart
  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 100) {
      _snack('Minimum withdrawal is ₹100', AppColors.red);
      return;
    }
    if (_upiCtrl.text.trim().isEmpty && _bankCtrl.text.trim().isEmpty) {
      _snack('Enter your UPI ID or bank account', AppColors.red);
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.api.dio.post('/api/wallet/withdraw/request', data: {
        'amount': amount,
        if (_upiCtrl.text.trim().isNotEmpty) 'upi_id': _upiCtrl.text.trim(),
        if (_bankCtrl.text.trim().isNotEmpty)
          'bank_account': _bankCtrl.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
```

With:

```dart
  Future<void> _submit() async {
    final amount = double.tryParse(_amountCtrl.text.trim()) ?? 0;
    if (amount < 100) {
      _snack('Minimum withdrawal is ₹100', AppColors.red);
      return;
    }
    if (!_bankVerified) {
      _snack('Add and verify your bank details before withdrawing', AppColors.red);
      return;
    }
    setState(() => _submitting = true);
    try {
      await widget.api.dio.post('/api/wallet/withdraw/request', data: {
        'amount': amount,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
```

(The rest of the `catch`/`finally` block is unchanged — leave it as-is.)

- [ ] **Step 4: Replace the bank-account section of `build` and the submit button's enabled condition**

Replace the block starting at `TextField(controller: _amountCtrl` through the end of the bank fields (i.e. everything from the amount field down to just before `const SizedBox(height: 20),` that precedes the submit button):

```dart
          TextField(
            controller: _amountCtrl,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
                labelText: 'Amount (₹)',
                prefixText: '₹ ',
                helperText:
                    'Min ₹100 · KYC required · Withdrawals 10 AM – 9 PM'),
          ),
          const SizedBox(height: 12),
          TextField(
              controller: _upiCtrl,
              decoration: const InputDecoration(
                  labelText: 'Your UPI ID (optional)', hintText: 'name@bank')),
          const SizedBox(height: 12),
          TextField(
              controller: _bankCtrl,
              decoration: const InputDecoration(
                  labelText: 'Your Bank A/c + IFSC (optional)',
                  hintText: 'A/c · IFSC')),
          const SizedBox(height: 20),
```

With:

```dart
          TextField(
            controller: _amountCtrl,
            enabled: _bankVerified,
            keyboardType: TextInputType.number,
            decoration: const InputDecoration(
                labelText: 'Amount (₹)',
                prefixText: '₹ ',
                helperText:
                    'Min ₹100 · KYC required · Withdrawals 10 AM – 9 PM'),
          ),
          const SizedBox(height: 16),
          if (_loadingBank)
            const Center(
                child: Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: CircularProgressIndicator(strokeWidth: 2),
            ))
          else if (_bank == null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.orange.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: AppColors.orange.withValues(alpha: 0.4)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(children: [
                    Icon(Icons.account_balance_rounded,
                        color: AppColors.orange, size: 18),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text('Add your bank details to withdraw',
                          style: TextStyle(
                              color: AppColors.orange,
                              fontWeight: FontWeight.w700,
                              fontSize: 13)),
                    ),
                  ]),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton(
                      onPressed: () {
                        Navigator.pop(context);
                        Navigator.of(context, rootNavigator: true).push(
                            MaterialPageRoute(
                                builder: (_) => const BankDetailsPage()));
                      },
                      child: const Text('Add Bank Details'),
                    ),
                  ),
                ],
              ),
            )
          else if (!_bankVerified)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.orange.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border:
                    Border.all(color: AppColors.orange.withValues(alpha: 0.4)),
              ),
              child: const Row(children: [
                Icon(Icons.hourglass_top_rounded,
                    color: AppColors.orange, size: 18),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                      'Your bank details are pending verification. You can withdraw once approved.',
                      style: TextStyle(color: AppColors.orange, fontSize: 12.5)),
                ),
              ]),
            )
          else
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.cardBg,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Row(children: [
                    Icon(Icons.verified_rounded,
                        color: AppColors.green, size: 16),
                    SizedBox(width: 6),
                    Text('Payout account',
                        style: TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ]),
                  const SizedBox(height: 6),
                  Text(_bank!['holder_name']?.toString() ?? '',
                      style:
                          const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  Text(
                      '${_bank!['bank_name'] ?? ''} · ${_maskAccount(_bank!['account_number']?.toString() ?? '')}',
                      style: const TextStyle(fontSize: 12.5)),
                  Text(_bank!['ifsc_code']?.toString() ?? '',
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
          const SizedBox(height: 20),
```

- [ ] **Step 5: Update the submit button's disabled condition**

Replace:

```dart
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (_submitting || !_withdrawOpen) ? null : _submit,
              child: _submitting
```

With:

```dart
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed:
                  (_submitting || !_withdrawOpen || !_bankVerified) ? null : _submit,
              child: _submitting
```

- [ ] **Step 6: Static analysis check**

Run: `cd mobile && flutter analyze lib/features/wallet/wallet_page.dart`
Expected: no new errors/warnings (pre-existing unrelated warnings elsewhere in the project, if any, are out of scope).

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/features/wallet/wallet_page.dart
git commit -m "feat(wallet): withdraw sheet only allows verified saved bank account"
```
