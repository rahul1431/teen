# Cricket Fantasy Contest Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a way to view/search all cricket fantasy contests across matches, edit a contest, see who joined it, and upload real images for player avatars and country flags — all from the admin panel.

**Architecture:** New read/write routes added to the existing `services/admin-service/src/index.ts` cricket-fantasy route group (direct `db.query`, no proxy to core-api-service — this feature doesn't touch money movement, only contest metadata and images, so it avoids the `callBetting`/`INTERNAL_SERVICE_KEY` proxy layer entirely). Two new admin-panel tabs are added to the existing `Cricket.tsx` page: "🌍 Countries" (flag management) and "📋 All Contests" (cross-match list + detail drawer with edit + participants). Player avatar upload reuses the exact multipart pattern already used for QR/emoji uploads.

**Tech Stack:** Fastify + `pg` (admin-service, TypeScript), React + antd + axios (`adminApi`) (admin-panel, TypeScript), PostgreSQL.

## Global Constraints

- No new DB tables or migrations — `cricket_countries` (id VARCHAR(10) PK, name, flag_url) already exists; only new *code* is needed.
- Money fields on a contest (`entry_fee`, `prize_pool`, `max_entries`, `prize_distribution`) become read-only server-side (not just UI-disabled) once `current_entries > 0`, per the approved spec (`docs/superpowers/specs/2026-07-13-cricket-contest-management-design.md`).
- This repo has no automated test harness for admin-service or admin-panel — every task's verification step is a manual `curl`/browser check, matching how prior fixes in this codebase were verified (e.g. `services/admin-service/src/index.ts` cricket fixes verified via `pm2 logs` + direct requests, not a test suite). Do not invent a test framework.
- Follow the existing RBAC role convention in `services/admin-service/src/index.ts`: `requireRole('support')` for content/image management (matches the sync-* and cricket-match-creation routes), `requireRole('finance')` for anything that edits contest economics (matches `POST fantasy/leagues`), plain `authenticate` for reads.
- Out of scope for this plan: mobile app changes (History tab, avatar/flag rendering in `cricket_page.dart`) and the `core-api-service` `/cricket/fantasy/my-history` route — those are covered by a separate follow-up plan per the spec's rollout section (mobile requires a new APK build, this plan is VPS-deploy-only).

---

## File Structure

- Modify: `services/admin-service/src/index.ts`
  - Add `CRICKET_AVATAR_UPLOAD_DIR` / `CRICKET_FLAG_UPLOAD_DIR` constants (near line 42) + `fs.mkdirSync` calls (near line 75)
  - Add `POST /api/admin/uploads/cricket-avatar`, `POST /api/admin/uploads/cricket-flag` (near line 986, after the existing emoji upload route)
  - Add `GET/POST/PATCH /api/admin/betting/cricket/countries[/:id]` (near line 1880, before the fantasy players/leagues routes)
  - Modify `GET /api/admin/betting/cricket/fantasy/players` (line 1866-1880) to join `cricket_countries` and return `flag_url`
  - Add `GET /api/admin/betting/cricket/fantasy/contests`, `GET .../leagues/:id`, `GET .../leagues/:id/entries`, `PATCH .../leagues/:id` (near line 1897, after the existing `POST fantasy/leagues`)
- Modify: `admin-panel/src/pages/games/Cricket.tsx`
  - Add `Drawer, DatePicker.RangePicker` usage (extend existing antd import at line 2-5)
  - Add `PlayerAvatarUploadField` and `CountryFlagUploadField` components (module scope, alongside `groupPlayersByTeam` near line 14)
  - Add new state, load/save functions for countries and contests (interspersed with existing state block, lines 34-76, and function block, lines 78-431)
  - Replace player avatar `Input` (line 879) with `PlayerAvatarUploadField`; extend player list rendering (line 662) to show a flag badge
  - Add two new `tabItems` entries: `countries`, `contests` (before the closing `]` at line 829)
  - Add the Contest Detail `Drawer` and Country Modal (before the closing `</div>` at line 1012)

No file in this plan exceeds ~1200 lines after changes (`Cricket.tsx` grows from 1014 to roughly 1250 lines) — still within the codebase's existing per-page convention (this file was already the largest single page before this change), so no split is warranted.

---

### Task 1: Image upload routes for player avatars and country flags

**Files:**
- Modify: `services/admin-service/src/index.ts:41-42` (add upload dir constants)
- Modify: `services/admin-service/src/index.ts:73-75` (create the new dirs on boot)
- Modify: `services/admin-service/src/index.ts:986` (insert two new routes after the emoji upload route)

**Interfaces:**
- Produces: `POST /api/admin/uploads/cricket-avatar` and `POST /api/admin/uploads/cricket-flag`, both multipart, both returning `{ url: string }` on success — consumed by Task 6 (`CountryFlagUploadField`) and Task 7 (`PlayerAvatarUploadField`) in the admin panel.

- [ ] **Step 1: Add the upload directory constants**

In `services/admin-service/src/index.ts`, immediately after line 42 (`const QR_UPLOAD_DIR = ...`), add:

```ts
// Cricket fantasy player avatars and country flag icons, served by nginx at /uploads/cricket-avatars/ and /uploads/cricket-flags/.
const CRICKET_AVATAR_UPLOAD_DIR = process.env.CRICKET_AVATAR_UPLOAD_DIR || '/opt/teen-prod/uploads/cricket-avatars'
const CRICKET_FLAG_UPLOAD_DIR = process.env.CRICKET_FLAG_UPLOAD_DIR || '/opt/teen-prod/uploads/cricket-flags'
```

- [ ] **Step 2: Create the directories on service boot**

Immediately after line 75 (`fs.mkdirSync(QR_UPLOAD_DIR, { recursive: true })`), add:

```ts
  fs.mkdirSync(CRICKET_AVATAR_UPLOAD_DIR, { recursive: true })
  fs.mkdirSync(CRICKET_FLAG_UPLOAD_DIR, { recursive: true })
```

- [ ] **Step 3: Add the two upload routes**

Immediately after the emoji upload route (ends at line 986 with `})`), add:

```ts
  // POST /api/admin/uploads/cricket-avatar — upload a fantasy player photo, returns its public URL
  app.post('/api/admin/uploads/cricket-avatar', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const file = await (req as any).file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    const ext = path.extname(file.filename || '').toLowerCase().slice(0, 8) || '.png'
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      return reply.code(400).send({ error: 'Unsupported image type' })
    }
    const fname = `avatar_${crypto.randomUUID()}${ext}`
    await pipeline(file.file, fs.createWriteStream(path.join(CRICKET_AVATAR_UPLOAD_DIR, fname)))
    return reply.send({ url: `/uploads/cricket-avatars/${fname}` })
  })

  // POST /api/admin/uploads/cricket-flag — upload a country flag icon, returns its public URL
  app.post('/api/admin/uploads/cricket-flag', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const file = await (req as any).file()
    if (!file) return reply.code(400).send({ error: 'No file uploaded' })
    const ext = path.extname(file.filename || '').toLowerCase().slice(0, 8) || '.png'
    if (!['.jpg', '.jpeg', '.png', '.webp', '.svg'].includes(ext)) {
      return reply.code(400).send({ error: 'Unsupported image type' })
    }
    const fname = `flag_${crypto.randomUUID()}${ext}`
    await pipeline(file.file, fs.createWriteStream(path.join(CRICKET_FLAG_UPLOAD_DIR, fname)))
    return reply.send({ url: `/uploads/cricket-flags/${fname}` })
  })
```

- [ ] **Step 4: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 5: Manual verification**

Run the service locally (`npm run dev` in `services/admin-service`, or verify after deploy in Task 10 — whichever this plan's executor has available), then:

```bash
curl -s -X POST http://127.0.0.1:3008/api/admin/uploads/cricket-avatar \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "file=@/path/to/test-image.png"
```
Expected: `{"url":"/uploads/cricket-avatars/avatar_<uuid>.png"}` and the file exists at `$CRICKET_AVATAR_UPLOAD_DIR/avatar_<uuid>.png`.

- [ ] **Step 6: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): add cricket avatar and flag upload routes"
```

---

### Task 2: Countries CRUD routes

**Files:**
- Modify: `services/admin-service/src/index.ts:1880` (insert before the existing `GET fantasy/players` route)

**Interfaces:**
- Produces: `GET /api/admin/betting/cricket/countries` → `{ countries: Array<{id, name, flag_url}> }`; `POST` (upsert by id) and `PATCH /:id` → `{ success: true, country: {...} }`. Consumed by Task 6 (Countries tab).
- Consumes: `cricket_countries` table (`id VARCHAR(10) PK, name VARCHAR(100), flag_url VARCHAR(255)`), already created by `infra/db/migrations/011_cricket_team_flags.sql`.

- [ ] **Step 1: Add the routes**

In `services/admin-service/src/index.ts`, immediately before line 1866 (`app.get('/api/admin/betting/cricket/fantasy/players'...`), add:

```ts
  // --- Cricket Countries (flag icons, shared by match-level flags and player country badges) ---
  app.get('/api/admin/betting/cricket/countries', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query('SELECT * FROM cricket_countries ORDER BY name ASC')
    return reply.send({ countries: res.rows })
  })

  app.post('/api/admin/betting/cricket/countries', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id, name, flag_url } = req.body as any
    if (!id || !name || !flag_url) return reply.code(400).send({ error: 'id, name, and flag_url are required' })
    const res = await db.query(
      `INSERT INTO cricket_countries (id, name, flag_url) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = $2, flag_url = $3 RETURNING *`,
      [id, name, flag_url]
    )
    return reply.send({ success: true, country: res.rows[0] })
  })

  app.patch('/api/admin/betting/cricket/countries/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const { name, flag_url } = req.body as any
    const fields: string[] = [], params: any[] = [id]
    let i = 2
    if (name !== undefined) { fields.push(`name = $${i++}`); params.push(name) }
    if (flag_url !== undefined) { fields.push(`flag_url = $${i++}`); params.push(flag_url) }
    if (!fields.length) return reply.code(400).send({ error: 'No fields to update' })
    const res = await db.query(`UPDATE cricket_countries SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
    if (!res.rows.length) return reply.code(404).send({ error: 'Country not found' })
    return reply.send({ success: true, country: res.rows[0] })
  })

```

- [ ] **Step 2: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Manual verification**

```bash
curl -s -X POST http://127.0.0.1:3008/api/admin/betting/cricket/countries \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"id":"TST","name":"Test Land","flag_url":"https://example.com/flag.png"}'
curl -s http://127.0.0.1:3008/api/admin/betting/cricket/countries -H "Authorization: Bearer $ADMIN_JWT"
```
Expected: POST returns `{"success":true,"country":{"id":"TST",...}}`; GET list includes it.

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): add cricket_countries CRUD routes"
```

---

### Task 3: Attach country flags to the fantasy players list

**Files:**
- Modify: `services/admin-service/src/index.ts:1866-1880` (existing `GET fantasy/players` route)

**Interfaces:**
- Produces: `GET /api/admin/betting/cricket/fantasy/players` response rows now include `flag_url` (null if the player's `team_name` has no matching `cricket_countries.name`). Consumed by Task 7 (player list flag badge).

- [ ] **Step 1: Extend the query with a countries join**

Replace the existing route body (lines 1866-1880) with:

```ts
  app.get('/api/admin/betting/cricket/fantasy/players', { onRequest: [authenticate] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT p.*,
        COALESCE(mp.matches_played, 0) AS matches_played,
        COALESCE(mp.total_points, 0) AS total_points,
        c.flag_url
      FROM cricket_fantasy_players p
      LEFT JOIN (
        SELECT player_id, COUNT(*) AS matches_played, SUM(fantasy_points) AS total_points
        FROM cricket_match_players
        GROUP BY player_id
      ) mp ON mp.player_id = p.id
      LEFT JOIN cricket_countries c ON c.name = p.team_name
      ORDER BY p.team_name ASC, p.role ASC, p.name ASC
    `)
    return reply.send({ players: res.rows })
  })
```

- [ ] **Step 2: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Manual verification**

```bash
curl -s http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/players -H "Authorization: Bearer $ADMIN_JWT" | head -c 500
```
Expected: each player object now has a `flag_url` key (value `null` unless a `cricket_countries` row matches its `team_name`).

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): attach country flag_url to fantasy players list"
```

---

### Task 4: Cross-match contest list, single-contest detail, and participants routes

**Files:**
- Modify: `services/admin-service/src/index.ts:1897` (insert after the existing `POST fantasy/leagues` route, which ends at line 1897)

**Interfaces:**
- Produces:
  - `GET /api/admin/betting/cricket/fantasy/contests?status=&match_id=&from=&to=&limit=&offset=` → `{ contests: [...], total: number }`
  - `GET /api/admin/betting/cricket/fantasy/leagues/:id` → `{ contest: {...} }` or 404
  - `GET /api/admin/betting/cricket/fantasy/leagues/:id/entries` → `{ entries: [...] }`
  - Consumed by Task 8 (Contests tab list) and Task 9 (Contest Detail Drawer).

- [ ] **Step 1: Add the three routes**

Immediately after line 1897 (the closing `})` of `POST /api/admin/betting/cricket/fantasy/leagues`), add:

```ts
  // GET /api/admin/betting/cricket/fantasy/contests — cross-match, filterable contest list
  app.get('/api/admin/betting/cricket/fantasy/contests', { onRequest: [authenticate] }, async (req, reply) => {
    const { status, match_id, from, to, limit, offset } = req.query as any
    const lim = Math.min(Number(limit) || 20, 100)
    const off = Number(offset) || 0
    const res = await db.query(
      `SELECT l.*, m.series, m.team_a, m.team_b, m.start_time AS match_start_time, m.status AS match_status,
              COUNT(*) OVER() AS total_count
       FROM cricket_fantasy_leagues l
       JOIN cricket_matches m ON m.id = l.match_id
       WHERE ($1::text IS NULL OR l.status = $1)
         AND ($2::uuid IS NULL OR l.match_id = $2)
         AND ($3::timestamptz IS NULL OR m.start_time >= $3)
         AND ($4::timestamptz IS NULL OR m.start_time <= $4)
       ORDER BY m.start_time DESC
       LIMIT $5 OFFSET $6`,
      [status || null, match_id || null, from || null, to || null, lim, off]
    )
    const total = res.rows[0]?.total_count ? Number(res.rows[0].total_count) : 0
    return reply.send({ contests: res.rows.map(({ total_count, ...r }) => r), total })
  })

  // GET /api/admin/betting/cricket/fantasy/leagues/:id — single contest detail
  app.get('/api/admin/betting/cricket/fantasy/leagues/:id', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT l.*, m.series, m.team_a, m.team_b, m.start_time AS match_start_time
       FROM cricket_fantasy_leagues l JOIN cricket_matches m ON m.id = l.match_id
       WHERE l.id = $1`, [id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Contest not found' })
    return reply.send({ contest: res.rows[0] })
  })

  // GET /api/admin/betting/cricket/fantasy/leagues/:id/entries — who joined this contest
  app.get('/api/admin/betting/cricket/fantasy/leagues/:id/entries', { onRequest: [authenticate] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT e.id, e.points, e.final_rank, e.payout_received, e.status, e.created_at,
              u.username, u.id AS user_id, t.id AS team_id
       FROM cricket_fantasy_entries e
       JOIN users u ON u.id = e.user_id
       JOIN user_fantasy_teams t ON t.id = e.team_id
       WHERE e.league_id = $1
       ORDER BY e.final_rank ASC NULLS LAST, e.points DESC`, [id]
    )
    return reply.send({ entries: res.rows })
  })

```

- [ ] **Step 2: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Manual verification**

```bash
curl -s "http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/contests?limit=5" -H "Authorization: Bearer $ADMIN_JWT"
curl -s "http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/leagues/<a-real-league-id>" -H "Authorization: Bearer $ADMIN_JWT"
curl -s "http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/leagues/<a-real-league-id>/entries" -H "Authorization: Bearer $ADMIN_JWT"
```
Expected: contests list returns `{contests: [...], total: N}`; single-contest returns `{contest: {...}}`; entries returns `{entries: [...]}` (empty array is fine if no one has joined yet).

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): add cross-match contests list, detail, and entries routes"
```

---

### Task 5: Edit a contest (with money-field lock)

**Files:**
- Modify: `services/admin-service/src/index.ts` (insert after Task 4's new routes)

**Interfaces:**
- Produces: `PATCH /api/admin/betting/cricket/fantasy/leagues/:id` → `200 { success: true, contest: {...} }`, or `409 { error }` if a money field is included and `current_entries > 0`, or `404`/`400`. Consumed by Task 9 (edit form submit).

- [ ] **Step 1: Add the route**

Immediately after the `entries` route added in Task 4, add:

```ts
  // PATCH /api/admin/betting/cricket/fantasy/leagues/:id — edit a contest.
  // name is always editable; entry_fee/prize_pool/max_entries/prize_distribution
  // are locked (409) once anyone has joined, so terms can't change under paying players.
  app.patch('/api/admin/betting/cricket/fantasy/leagues/:id', { onRequest: [authenticate, requireRole('finance')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = req.body as any
    const current = await db.query('SELECT current_entries FROM cricket_fantasy_leagues WHERE id = $1', [id])
    if (!current.rows.length) return reply.code(404).send({ error: 'Contest not found' })
    const hasEntries = current.rows[0].current_entries > 0
    const touchesMoneyFields = body.entry_fee !== undefined || body.prize_pool !== undefined || body.max_entries !== undefined || body.prize_distribution !== undefined
    if (hasEntries && touchesMoneyFields) {
      return reply.code(409).send({ error: 'This contest already has joined entries — entry fee, prize pool, max entries, and prize distribution are locked. You can still rename it.' })
    }
    const fields: string[] = [], params: any[] = [id]
    let i = 2
    if (body.name !== undefined) { fields.push(`name = $${i++}`); params.push(body.name) }
    if (body.entry_fee !== undefined) { fields.push(`entry_fee = $${i++}`); params.push(body.entry_fee) }
    if (body.prize_pool !== undefined) { fields.push(`prize_pool = $${i++}`); params.push(body.prize_pool) }
    if (body.max_entries !== undefined) { fields.push(`max_entries = $${i++}`); params.push(body.max_entries) }
    if (body.prize_distribution !== undefined) { fields.push(`prize_distribution = $${i++}`); params.push(JSON.stringify(body.prize_distribution)) }
    if (!fields.length) return reply.code(400).send({ error: 'No editable fields provided' })
    const res = await db.query(`UPDATE cricket_fantasy_leagues SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, params)
    return reply.send({ success: true, contest: res.rows[0] })
  })

```

- [ ] **Step 2: Type-check**

Run: `cd services/admin-service && npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Manual verification**

```bash
# Rename a contest with zero entries — should succeed and allow money fields too
curl -s -X PATCH "http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/leagues/<zero-entry-league-id>" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"name":"Renamed Contest","entry_fee":75}'

# Try to change entry_fee on a contest that has entries — should 409
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH "http://127.0.0.1:3008/api/admin/betting/cricket/fantasy/leagues/<has-entries-league-id>" \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"entry_fee":75}'
```
Expected: first call returns `200` with updated contest; second call prints `409`.

- [ ] **Step 4: Commit**

```bash
git add services/admin-service/src/index.ts
git commit -m "feat(admin-service): add contest edit route with money-field lock"
```

---

### Task 6: Admin panel — Countries tab

**Files:**
- Modify: `admin-panel/src/pages/games/Cricket.tsx:2-6` (extend antd/icon imports)
- Modify: `admin-panel/src/pages/games/Cricket.tsx:14` (add `CountryFlagUploadField` component after `groupPlayersByTeam`)
- Modify: `admin-panel/src/pages/games/Cricket.tsx:34-76` (add state)
- Modify: `admin-panel/src/pages/games/Cricket.tsx:433-438` (load countries on mount)
- Modify: `admin-panel/src/pages/games/Cricket.tsx:829` (new tab item)
- Modify: `admin-panel/src/pages/games/Cricket.tsx:1011` (new Modal)

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/admin/betting/cricket/countries[/:id]` (Task 2), `POST /api/admin/uploads/cricket-flag` (Task 1).

- [ ] **Step 1: Extend imports**

Replace `admin-panel/src/pages/games/Cricket.tsx:2-6`:

```tsx
import {
  Card, Form, Switch, InputNumber, Select, Button, Table, Tag,
  Space, Modal, Input, Typography, Divider, Popconfirm, message, Row, Col, DatePicker, Tabs, Alert, Collapse, Avatar, Drawer, Upload
} from 'antd'
import { ReloadOutlined, PlusOutlined, SyncOutlined, CloudDownloadOutlined, DeleteOutlined, TeamOutlined, TrophyOutlined, UserOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons'
```

- [ ] **Step 2: Add `CountryFlagUploadField` component**

Immediately after `groupPlayersByTeam` (after line 22, before `export default function Cricket()`), add:

```tsx
function CountryFlagUploadField({ form }: { form: any }) {
  const [uploading, setUploading] = useState(false)
  const url: string | undefined = Form.useWatch('flag_url', form)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await adminApi.post('/uploads/cricket-flag', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      form.setFieldsValue({ flag_url: res.data.url })
      message.success('Flag uploaded')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <Form.Item label="Flag Icon" required>
      <Form.Item name="flag_url" noStyle rules={[{ required: true, message: 'Upload a flag icon' }]}>
        <Input type="hidden" />
      </Form.Item>
      <Space direction="vertical">
        <Upload showUploadList={false} accept="image/*" maxCount={1}
          beforeUpload={(file) => { upload(file as File); return false }}>
          <Button icon={<UploadOutlined />} loading={uploading}>{url ? 'Replace Flag' : 'Upload Flag'}</Button>
        </Upload>
        {url && <img src={url} alt="Flag" style={{ width: 60, height: 40, objectFit: 'cover', border: '1px solid #eee', borderRadius: 4 }} />}
      </Space>
    </Form.Item>
  )
}
```

- [ ] **Step 3: Add state**

Immediately after line 65 (`const [loadingLeaguesFor, setLoadingLeaguesFor] = useState<string | null>(null)`), add:

```tsx
  // --- Countries States ---
  const [countries, setCountries] = useState<any[]>([])
  const [loadingCountries, setLoadingCountries] = useState(false)
  const [countryOpen, setCountryOpen] = useState(false)
  const [editingCountry, setEditingCountry] = useState<any>(null)
  const [cForm] = Form.useForm()
```

- [ ] **Step 4: Add load/save functions**

Immediately after the `deleteLeague` function (after line 285), add:

```tsx
  const loadCountries = () => {
    setLoadingCountries(true)
    adminApi.get('/betting/cricket/countries')
      .then(r => setCountries(r.data.countries || []))
      .finally(() => setLoadingCountries(false))
  }

  const openCountryModal = (country?: any) => {
    setEditingCountry(country || null)
    cForm.resetFields()
    if (country) cForm.setFieldsValue(country)
    setCountryOpen(true)
  }

  const saveCountry = async (v: any) => {
    try {
      if (editingCountry) {
        await adminApi.patch(`/betting/cricket/countries/${editingCountry.id}`, { name: v.name, flag_url: v.flag_url })
      } else {
        await adminApi.post('/betting/cricket/countries', { id: v.id, name: v.name, flag_url: v.flag_url })
      }
      message.success('Country saved')
      setCountryOpen(false)
      loadCountries()
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to save country')
    }
  }
```

- [ ] **Step 5: Load countries on mount**

Replace `admin-panel/src/pages/games/Cricket.tsx:433-438`:

```tsx
  useEffect(() => {
    loadConfig()
    loadMatches()
    loadPlayers()
    loadSeriesCatalog()
    loadCountries()
  }, [])
```

- [ ] **Step 6: Add the Countries tab**

Immediately before the closing `]` of `tabItems` (line 829), add a new array entry:

```tsx
    ,{
      key: 'countries',
      label: '🌍 Countries',
      children: (
        <Card title="Country Flags"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openCountryModal()}>Add Country</Button>}
          loading={loadingCountries}
        >
          <Table
            rowKey="id"
            dataSource={countries}
            columns={[
              { title: 'Flag', dataIndex: 'flag_url', render: (u: string) => <img src={u} alt="" style={{ width: 32, height: 22, objectFit: 'cover', border: '1px solid #eee' }} /> },
              { title: 'Code', dataIndex: 'id' },
              { title: 'Country / Team Name', dataIndex: 'name' },
              { title: 'Action', render: (record: any) => <Button size="small" onClick={() => openCountryModal(record)}>Edit</Button> },
            ]}
          />
        </Card>
      )
    }
```

- [ ] **Step 7: Add the Country Modal**

Immediately before the closing `</div>` (line 1012, after the Scoring Rulebook Modal's closing `</Modal>`), add:

```tsx

      {/* Country / Flag Modal */}
      <Modal open={countryOpen} title={editingCountry ? 'Edit Country' : 'Add Country'} onCancel={() => setCountryOpen(false)} onOk={() => cForm.submit()} okText="Save">
        <Form form={cForm} layout="vertical" onFinish={saveCountry}>
          <Form.Item name="id" label="Code (e.g. IND, AUS)" rules={[{ required: true }]}>
            <Input maxLength={10} disabled={!!editingCountry} />
          </Form.Item>
          <Form.Item name="name" label="Country / Team Name" rules={[{ required: true }]}><Input placeholder="e.g. India" /></Form.Item>
          <CountryFlagUploadField form={cForm} />
        </Form>
      </Modal>
```

- [ ] **Step 8: Manual verification**

Run `cd admin-panel && npm run build` to confirm it compiles, then (after Task 10's deploy, or via local dev server if available) open the Cricket page → Countries tab → Add Country → upload a flag image → Save. Confirm the new row appears in the table with the uploaded flag thumbnail.

- [ ] **Step 9: Commit**

```bash
git add admin-panel/src/pages/games/Cricket.tsx
git commit -m "feat(admin-panel): add Countries tab with flag upload"
```

---

### Task 7: Admin panel — player avatar upload + flag badge in the player list

**Files:**
- Modify: `admin-panel/src/pages/games/Cricket.tsx` (component, form field, list rendering)

**Interfaces:**
- Consumes: `POST /api/admin/uploads/cricket-avatar` (Task 1), `flag_url` now present on each player from Task 3.

- [ ] **Step 1: Add `PlayerAvatarUploadField` component**

Immediately after the `CountryFlagUploadField` component added in Task 6 Step 2, add:

```tsx
function PlayerAvatarUploadField({ form }: { form: any }) {
  const [uploading, setUploading] = useState(false)
  const url: string | undefined = Form.useWatch('avatar_url', form)

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await adminApi.post('/uploads/cricket-avatar', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      form.setFieldsValue({ avatar_url: res.data.url })
      message.success('Photo uploaded')
    } catch (e: any) {
      message.error(e.response?.data?.error || 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <Form.Item label="Player Photo">
      <Form.Item name="avatar_url" noStyle>
        <Input type="hidden" />
      </Form.Item>
      <Space direction="vertical">
        <Space>
          <Upload showUploadList={false} accept="image/*" maxCount={1}
            beforeUpload={(file) => { upload(file as File); return false }}>
            <Button icon={<UploadOutlined />} loading={uploading}>{url ? 'Replace Photo' : 'Upload Photo'}</Button>
          </Upload>
          <Text type="secondary" style={{ fontSize: 12 }}>or paste a URL below</Text>
        </Space>
        <Input placeholder="https://..." value={url} onChange={e => form.setFieldsValue({ avatar_url: e.target.value })} />
        {url && <Avatar src={url} size={48} />}
      </Space>
    </Form.Item>
  )
}
```

- [ ] **Step 2: Replace the plain-text avatar_url field**

Replace `admin-panel/src/pages/games/Cricket.tsx:879` (`<Form.Item name="avatar_url" label="Avatar URL"><Input placeholder="https://..." /></Form.Item>`) with:

```tsx
          <PlayerAvatarUploadField form={pForm} />
```

- [ ] **Step 3: Show the flag badge in the player list**

Replace `admin-panel/src/pages/games/Cricket.tsx:662` (`<Avatar src={p.avatar_url || undefined} size={36} icon={!p.avatar_url && <UserOutlined />} />`) with:

```tsx
                            <div style={{ position: 'relative' }}>
                              <Avatar src={p.avatar_url || undefined} size={36} icon={!p.avatar_url && <UserOutlined />} />
                              {p.flag_url && (
                                <img src={p.flag_url} alt="" style={{ position: 'absolute', bottom: -2, right: -2, width: 16, height: 11, border: '1px solid #fff', borderRadius: 2 }} />
                              )}
                            </div>
```

- [ ] **Step 4: Manual verification**

Run `cd admin-panel && npm run build` to confirm it compiles, then (after deploy) open Cricket page → Fantasy Contests tab → Add Player → upload a photo → set `team_name` to a country that has a flag configured (from Task 6) → Save. Confirm the roster list shows both the player photo and a small flag badge in the corner.

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/pages/games/Cricket.tsx
git commit -m "feat(admin-panel): add player avatar upload and country flag badge"
```

---

### Task 8: Admin panel — "All Contests" tab (filterable cross-match list)

**Files:**
- Modify: `admin-panel/src/pages/games/Cricket.tsx` (state, load function, new tab)

**Interfaces:**
- Consumes: `GET /api/admin/betting/cricket/fantasy/contests` (Task 4).
- Produces: `openContestDrawer(id)` function and `contestDrawerOpen`/`selectedContestId` state, consumed by Task 9.

- [ ] **Step 1: Add state**

Immediately after the Countries state block added in Task 6 Step 3, add:

```tsx
  // --- All Contests States ---
  const [contests, setContests] = useState<any[]>([])
  const [contestsTotal, setContestsTotal] = useState(0)
  const [loadingContests, setLoadingContests] = useState(false)
  const [contestFilters, setContestFilters] = useState<{ status?: string; match_id?: string; from?: string; to?: string }>({})
  const [contestPage, setContestPage] = useState(1)
  const [contestDrawerOpen, setContestDrawerOpen] = useState(false)
  const [selectedContestId, setSelectedContestId] = useState<string | null>(null)
```

- [ ] **Step 2: Add the load function**

Immediately after `loadCountries` (added in Task 6 Step 4), add:

```tsx
  const CONTEST_PAGE_SIZE = 10

  const loadContests = (page = contestPage, filters = contestFilters) => {
    setLoadingContests(true)
    adminApi.get('/betting/cricket/fantasy/contests', {
      params: { ...filters, limit: CONTEST_PAGE_SIZE, offset: (page - 1) * CONTEST_PAGE_SIZE }
    })
      .then(r => { setContests(r.data.contests || []); setContestsTotal(r.data.total || 0) })
      .finally(() => setLoadingContests(false))
  }

  const openContestDrawer = (id: string) => {
    setSelectedContestId(id)
    setContestDrawerOpen(true)
  }
```

- [ ] **Step 3: Load contests when the tab's filters change**

Immediately after the `useEffect` block added in Task 6 Step 5, add:

```tsx
  useEffect(() => {
    loadContests(1, contestFilters)
    setContestPage(1)
  }, [contestFilters])
```

- [ ] **Step 4: Add the "All Contests" tab**

Immediately after the Countries tab entry added in Task 6 Step 6 (still before the closing `]` of `tabItems`), add:

```tsx
    ,{
      key: 'contests',
      label: '📋 All Contests',
      children: (
        <Card title="All Fantasy Contests"
          extra={
            <Space>
              <Select allowClear placeholder="Status" style={{ width: 130 }}
                options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'settled', label: 'Settled' }, { value: 'cancelled', label: 'Cancelled' }]}
                onChange={v => setContestFilters(f => ({ ...f, status: v }))} />
              <Select allowClear placeholder="Match" style={{ width: 240 }} showSearch optionFilterProp="label"
                options={matches.map(m => ({ value: m.id, label: `${m.team_a} vs ${m.team_b} (${m.series})` }))}
                onChange={v => setContestFilters(f => ({ ...f, match_id: v }))} />
              <DatePicker.RangePicker onChange={(dates) => setContestFilters(f => ({
                ...f,
                from: dates?.[0]?.toISOString(),
                to: dates?.[1]?.toISOString(),
              }))} />
              <Button onClick={() => loadContests(contestPage, contestFilters)}>Refresh</Button>
            </Space>
          }
          loading={loadingContests}
        >
          <Table
            rowKey="id"
            dataSource={contests}
            pagination={{
              current: contestPage,
              pageSize: CONTEST_PAGE_SIZE,
              total: contestsTotal,
              onChange: (page) => { setContestPage(page); loadContests(page, contestFilters) },
            }}
            columns={[
              { title: 'Match', render: (r: any) => `${r.team_a} vs ${r.team_b}` },
              { title: 'Contest Name', dataIndex: 'name' },
              { title: 'Entry Fee', dataIndex: 'entry_fee', render: (v: number) => `₹${Number(v)}` },
              { title: 'Prize Pool', dataIndex: 'prize_pool', render: (v: number) => `₹${Number(v)}` },
              { title: 'Entries', render: (r: any) => `${r.current_entries}/${r.max_entries}` },
              { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag color={s === 'settled' ? 'red' : s === 'cancelled' ? 'default' : 'green'}>{s}</Tag> },
              { title: 'Action', render: (r: any) => <Button size="small" icon={<EyeOutlined />} onClick={() => openContestDrawer(r.id)}>View</Button> },
            ]}
          />
        </Card>
      )
    }
```

- [ ] **Step 5: Manual verification**

Run `cd admin-panel && npm run build` to confirm it compiles, then (after deploy) open Cricket page → All Contests tab. Confirm the table lists contests across all matches, filters by status/match/date narrow the list, and pagination works when there are more than 10 contests.

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/pages/games/Cricket.tsx
git commit -m "feat(admin-panel): add All Contests tab with filters"
```

---

### Task 9: Admin panel — Contest Detail Drawer (edit + participants)

**Files:**
- Modify: `admin-panel/src/pages/games/Cricket.tsx` (state, load/save functions, Drawer component)

**Interfaces:**
- Consumes: `GET .../leagues/:id`, `GET .../leagues/:id/entries` (Task 4), `PATCH .../leagues/:id` (Task 5), `contestDrawerOpen`/`selectedContestId` state (Task 8).

- [ ] **Step 1: Add state and a form instance**

Immediately after the state added in Task 8 Step 1, add:

```tsx
  const [contestDetail, setContestDetail] = useState<any>(null)
  const [contestEntries, setContestEntries] = useState<any[]>([])
  const [loadingContestDetail, setLoadingContestDetail] = useState(false)
  const [savingContest, setSavingContest] = useState(false)
  const [contestEditForm] = Form.useForm()
```

- [ ] **Step 2: Load contest detail + entries when the drawer opens**

Immediately after `openContestDrawer` (added in Task 8 Step 2), add:

```tsx
  const loadContestDetail = (id: string) => {
    setLoadingContestDetail(true)
    Promise.all([
      adminApi.get(`/betting/cricket/fantasy/leagues/${id}`),
      adminApi.get(`/betting/cricket/fantasy/leagues/${id}/entries`),
    ])
      .then(([detailRes, entriesRes]) => {
        setContestDetail(detailRes.data.contest)
        setContestEntries(entriesRes.data.entries || [])
        contestEditForm.setFieldsValue(detailRes.data.contest)
      })
      .finally(() => setLoadingContestDetail(false))
  }

  const saveContestEdit = async (v: any) => {
    if (!selectedContestId) return
    setSavingContest(true)
    try {
      const payload: any = { name: v.name }
      if (contestDetail?.current_entries === 0) {
        payload.entry_fee = v.entry_fee
        payload.prize_pool = v.prize_pool
        payload.max_entries = v.max_entries
      }
      await adminApi.patch(`/betting/cricket/fantasy/leagues/${selectedContestId}`, payload)
      message.success('Contest updated')
      loadContestDetail(selectedContestId)
      loadContests(contestPage, contestFilters)
    } catch (e: any) {
      message.error(e?.response?.data?.error || 'Failed to update contest')
    } finally {
      setSavingContest(false)
    }
  }
```

- [ ] **Step 3: Trigger the load when the drawer opens**

Immediately after the `useEffect` added in Task 8 Step 3, add:

```tsx
  useEffect(() => {
    if (contestDrawerOpen && selectedContestId) {
      loadContestDetail(selectedContestId)
    } else {
      setContestDetail(null)
      setContestEntries([])
    }
  }, [contestDrawerOpen, selectedContestId])
```

- [ ] **Step 4: Add the Drawer**

Immediately after the Country Modal added in Task 6 Step 7 (still before the closing `</div>`), add:

```tsx

      {/* Contest Detail Drawer */}
      <Drawer
        title={contestDetail ? `${contestDetail.team_a} vs ${contestDetail.team_b} — ${contestDetail.name}` : 'Contest Detail'}
        open={contestDrawerOpen}
        onClose={() => setContestDrawerOpen(false)}
        width={640}
        loading={loadingContestDetail}
      >
        {contestDetail && (
          <>
            <Form form={contestEditForm} layout="vertical" onFinish={saveContestEdit}>
              <Form.Item name="name" label="Contest Name" rules={[{ required: true }]}><Input /></Form.Item>
              {contestDetail.current_entries > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginBottom: 16 }}
                  message={`This contest has ${contestDetail.current_entries} joined entries — entry fee, prize pool, and max entries are locked.`}
                />
              )}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="entry_fee" label="Entry Fee (₹)"><InputNumber min={0} style={{ width: '100%' }} disabled={contestDetail.current_entries > 0} /></Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="prize_pool" label="Prize Pool (₹)"><InputNumber min={0} style={{ width: '100%' }} disabled={contestDetail.current_entries > 0} /></Form.Item>
                </Col>
              </Row>
              <Form.Item name="max_entries" label="Max Entries"><InputNumber min={2} style={{ width: '100%' }} disabled={contestDetail.current_entries > 0} /></Form.Item>
              <Button type="primary" htmlType="submit" loading={savingContest}>Save Changes</Button>
            </Form>

            <Divider>Participants ({contestEntries.length})</Divider>
            <Table
              rowKey="id"
              size="small"
              dataSource={contestEntries}
              pagination={{ pageSize: 10 }}
              columns={[
                { title: 'User', dataIndex: 'username' },
                { title: 'Rank', dataIndex: 'final_rank', render: (r: number | null) => r ?? '-' },
                { title: 'Points', dataIndex: 'points', render: (p: number) => Number(p).toFixed(1) },
                { title: 'Payout', dataIndex: 'payout_received', render: (p: number) => `₹${Number(p).toFixed(0)}` },
                { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag>{s}</Tag> },
              ]}
            />
          </>
        )}
      </Drawer>
```

- [ ] **Step 5: Manual verification**

Run `cd admin-panel && npm run build` to confirm it compiles, then (after deploy) open Cricket page → All Contests tab → click "View" on a contest. Confirm:
- The drawer opens with the contest name, fee, pool, and max entries pre-filled.
- For a contest with zero entries, editing entry fee/prize pool/max entries and clicking Save Changes succeeds and the list reflects the update.
- For a contest with entries, the money fields are disabled and the warning banner shows; only renaming works.
- The participants table lists everyone who joined, with rank/points/payout/status (empty table is fine if no one has joined yet).

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/pages/games/Cricket.tsx
git commit -m "feat(admin-panel): add contest detail drawer with edit and participants"
```

---

### Task 10: Deploy to VPS and verify end-to-end

**Files:** none (deployment only)

**Interfaces:** none — this task ships Tasks 1-9's committed code to production.

- [ ] **Step 1: Push the branch**

```bash
git push origin feature/admin-responsive
```

(Confirm with the user which branch the VPS should pull — per `docs/superpowers/plans/../vps-deploy-topology` memory, the VPS tracks `claude/confident-archimedes-e2dd1k`, not necessarily this feature branch. If this branch differs from what the VPS pulls, merge/rebase onto that branch first, or SFTP the changed files directly as `services/admin-service/src/index.ts` and `admin-panel/src/pages/games/Cricket.tsx` are the only two files this plan touches.)

- [ ] **Step 2: Deploy admin-service**

```bash
ssh root@64.204.130.181 "cd /opt/teen-prod/services/admin-service && npx tsc --noEmit"
ssh root@64.204.130.181 "cd /opt/teen-prod/services/admin-service && npm run build"
ssh root@64.204.130.181 "pm2 restart teen-admin-svc"
```
Expected: tsc produces no output; build succeeds; pm2 shows `teen-admin-svc` status `online` with a fresh uptime.

- [ ] **Step 3: Deploy admin-panel**

```bash
cd admin-panel && npm run build
```
Then copy `admin-panel/dist/*` to the VPS docroot (per `admin-panel-real-docroot` memory: `/home/admin/web/game.myonlinejoker.com/public_html/admin/`, NOT `/opt/teen-prod/admin-panel/dist`):
```bash
scp -r admin-panel/dist/. root@64.204.130.181:/home/admin/web/game.myonlinejoker.com/public_html/admin/
```

- [ ] **Step 4: Verify nginx serves the new upload directories**

```bash
ssh root@64.204.130.181 "grep -n 'uploads' /etc/nginx/conf.d/domains/game.myonlinejoker.com.ssl.conf || grep -rn 'uploads' /home/admin/conf/web/game.myonlinejoker.com/nginx.conf"
```
If `/uploads/` is already a generic static location (it should be, since `/uploads/qr/` and `/uploads/emojis/` already work per the existing QR/emoji upload routes), no nginx change is needed — the new `cricket-avatars`/`cricket-flags` subdirectories are served the same way. If it's not generic, add the two new subpaths following the existing QR/emoji location block pattern and reload nginx (`nginx -t && systemctl reload nginx`).

- [ ] **Step 5: End-to-end verification in the browser**

Log into the live admin panel, go to the Cricket page, and confirm:
- Countries tab: add a country with an uploaded flag, see it in the list.
- Fantasy Contests tab: add a player with an uploaded photo and a `team_name` matching the country just added; confirm the roster shows the photo + flag badge.
- All Contests tab: the full list of existing contests appears; filtering by status/match/date narrows it; View opens the detail drawer.
- In the drawer: edit a zero-entry contest's fee successfully; confirm a contest with entries shows locked fields; confirm the participants table renders.

- [ ] **Step 6: Report the deployed state**

Summarize to the user which routes/tabs are live, and note explicitly that mobile (History tab, avatar/flag rendering in the app) is a separate follow-up requiring a new APK build, per the plan's Global Constraints.
