import os

index_path = r"c:\Users\Rahul\Desktop\teen\services\admin-service\src\index.ts"

new_routes = """
  // ---- SEO Settings ----

  app.get('/api/admin/seo/settings', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query('SELECT key, value FROM seo_settings')
    const settings: Record<string, string> = {}
    for (const row of res.rows) {
      settings[row.key] = row.value || ''
    }
    return reply.send(settings)
  })

  app.post('/api/admin/seo/settings', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.record(z.string()).parse(req.body)
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      for (const [key, value] of Object.entries(body)) {
        await client.query(
          `INSERT INTO seo_settings (key, value, updated_by, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [key, value, me.sub]
        )
      }
      await client.query('COMMIT')
      return reply.send({ success: true })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // ---- Marketing Campaigns ----

  app.get('/api/admin/marketing/campaigns', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT 
        c.id, c.name, c.description, c.utm_source, c.utm_medium, c.utm_campaign, c.clicks, c.is_active, c.created_at,
        COUNT(DISTINCT uca.user_id)::int AS signups,
        COUNT(DISTINCT po.id)::int AS deposits,
        COALESCE(SUM(po.amount), 0)::float AS total_deposit_amount
      FROM marketing_campaigns c
      LEFT JOIN user_campaign_attribution uca ON uca.campaign_id = c.id
      LEFT JOIN payment_orders po ON po.user_id = uca.user_id AND po.type = 'deposit' AND po.status = 'paid'
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `)
    return reply.send(res.rows)
  })

  app.post('/api/admin/marketing/campaigns', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      utm_source: z.string().min(1).max(50),
      utm_medium: z.string().max(50).optional().nullable(),
      utm_campaign: z.string().max(50).optional().nullable(),
    }).parse(req.body)
    try {
      const res = await db.query(
        `INSERT INTO marketing_campaigns (name, description, utm_source, utm_medium, utm_campaign, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [body.name, body.description || null, body.utm_source, body.utm_medium || null, body.utm_campaign || null, me.sub]
      )
      return reply.send({ success: true, id: res.rows[0].id })
    } catch (e: any) {
      if (e.code === '23505') return reply.code(400).send({ error: 'Campaign name already exists' })
      throw e
    }
  })

  app.patch('/api/admin/marketing/campaigns/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const { id } = req.params as any
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional().nullable(),
      is_active: z.boolean().optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    if (body.name !== undefined) { updates.push(`name = $${idx}`); params.push(body.name); idx++ }
    if (body.description !== undefined) { updates.push(`description = $${idx}`); params.push(body.description); idx++ }
    if (body.is_active !== undefined) { updates.push(`is_active = $${idx}`); params.push(body.is_active); idx++ }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE marketing_campaigns SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    return reply.send({ success: true })
  })

  app.delete('/api/admin/marketing/campaigns/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query('DELETE FROM marketing_campaigns WHERE id = $1', [id])
    return reply.send({ success: true })
  })

  // ---- Referrals Analytics ----

  app.get('/api/admin/marketing/referrals', { onRequest: [authenticate, requireRole('support')] }, async (_req, reply) => {
    const res = await db.query(`
      SELECT 
        u.id AS referrer_id,
        u.username AS referrer_username,
        u.phone AS referrer_phone,
        COUNT(r.id)::int AS total_referred,
        COUNT(CASE WHEN r.status = 'qualified' OR r.status = 'rewarded' THEN 1 END)::int AS qualified_referred,
        COALESCE(SUM(CASE WHEN r.status = 'rewarded' THEN r.reward_amount ELSE 0 END), 0)::float AS rewards_earned
      FROM referrals r
      JOIN users u ON u.id = r.referrer_id
      GROUP BY u.id, u.username, u.phone
      ORDER BY total_referred DESC
      LIMIT 100
    `)
    return reply.send(res.rows)
  })

  // ---- Knowledge Base ----

  app.get('/api/admin/support/kb', { onRequest: [authenticate, requireRole('readonly')] }, async (req, reply) => {
    const { search, category } = req.query as any
    let query = `
      SELECT k.*, a.username AS created_by_username, b.username AS updated_by_username
      FROM support_kb_articles k
      LEFT JOIN admin_users a ON a.id = k.created_by
      LEFT JOIN admin_users b ON b.id = k.updated_by
      WHERE 1=1`
    const params: any[] = []
    let idx = 1
    if (category) {
      query += ` AND k.category = $${idx}`
      params.push(category)
      idx++
    }
    if (search) {
      query += ` AND (k.title ILIKE $${idx} OR k.content_md ILIKE $${idx})`
      params.push(`%${search}%`)
      idx++
    }
    query += ` ORDER BY k.updated_at DESC`
    const res = await db.query(query, params)
    return reply.send(res.rows)
  })

  app.get('/api/admin/support/kb/:id', { onRequest: [authenticate, requireRole('readonly')] }, async (req, reply) => {
    const { id } = req.params as any
    const res = await db.query(
      `SELECT k.*, a.username AS created_by_username, b.username AS updated_by_username
       FROM support_kb_articles k
       LEFT JOIN admin_users a ON a.id = k.created_by
       LEFT JOIN admin_users b ON b.id = k.updated_by
       WHERE k.id = $1`,
      [id]
    )
    if (!res.rows.length) return reply.code(404).send({ error: 'Article not found' })
    return reply.send(res.rows[0])
  })

  app.post('/api/admin/support/kb', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const body = z.object({
      title: z.string().min(1).max(255),
      category: z.string().min(1).max(100),
      content_md: z.string().min(1),
    }).parse(req.body)
    const res = await db.query(
      `INSERT INTO support_kb_articles (title, category, content_md, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING id`,
      [body.title, body.category, body.content_md, me.sub]
    )
    return reply.send({ success: true, id: res.rows[0].id })
  })

  app.patch('/api/admin/support/kb/:id', { onRequest: [authenticate, requireRole('support')] }, async (req, reply) => {
    const me = req.user as any
    const { id } = req.params as any
    const body = z.object({
      title: z.string().min(1).max(255).optional(),
      category: z.string().min(1).max(100).optional(),
      content_md: z.string().min(1).optional(),
    }).parse(req.body)
    const updates: string[] = []
    const params: any[] = []
    let idx = 1
    if (body.title !== undefined) { updates.push(`title = $${idx}`); params.push(body.title); idx++ }
    if (body.category !== undefined) { updates.push(`category = $${idx}`); params.push(body.category); idx++ }
    if (body.content_md !== undefined) { updates.push(`content_md = $${idx}`); params.push(body.content_md); idx++ }
    if (!updates.length) return reply.code(400).send({ error: 'Nothing to update' })
    updates.push(`updated_by = $${idx}`); params.push(me.sub); idx++
    updates.push(`updated_at = NOW()`)
    params.push(id)
    await db.query(`UPDATE support_kb_articles SET ${updates.join(', ')} WHERE id = $${idx}`, params)
    return reply.send({ success: true })
  })

  app.delete('/api/admin/support/kb/:id', { onRequest: [authenticate, requireRole('superadmin')] }, async (req, reply) => {
    const { id } = req.params as any
    await db.query('DELETE FROM support_kb_articles WHERE id = $1', [id])
    return reply.send({ success: true })
  })
"""

def patch():
    with open(index_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the target delete banner block
    target_str = "app.delete('/api/admin/cms/banners/:id'"
    if target_str not in content:
        print("Could not find banners delete block!")
        return

    lines = content.split('\n')
    target_idx = -1
    for i, line in enumerate(lines):
        if target_str in line:
            target_idx = i
            break

    # Look for the closing '})' of the app.delete block
    closing_idx = -1
    for i in range(target_idx, len(lines)):
        if lines[i].strip() == "})":
            closing_idx = i
            break

    if closing_idx == -1:
        print("Could not find closing block for app.delete!")
        return

    # Insert the new routes after the closing line
    lines.insert(closing_idx + 1, new_routes)

    with open(index_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    print("Patched index.ts successfully!")

if __name__ == "__main__":
    patch()
