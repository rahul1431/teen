import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'

// Player profile enrichment from Wikidata + Wikimedia Commons.
//
// Why not CricAPI: the free tier is capped at 100 calls/key/day, which a full
// roster refresh burns through immediately. Wikidata's SPARQL endpoint and the
// MediaWiki API are free, keyless and built for bulk reads — the only ask is a
// descriptive User-Agent and reasonable pacing, both honoured below.
//
// Why per-name lookup rather than one bulk "give me the India squad" query:
// that bulk query was tried and is unusable — team-membership statements on
// Wikidata lack end dates, so it returns retired players, women's-team players
// and other nations' internationals together, with batting/bowling style
// populated on essentially none of them. Roster membership is therefore
// curated in the migration; this module only fills in facts about a player we
// already know we want.

const UA = 'MyOnlineJoker/1.0 (cricket player profile sync; +https://game.myonlinejoker.com)'
const SPARQL = 'https://query.wikidata.org/sparql'
const CRICKETER_QID = 'Q12299841'

// nginx serves /uploads/ from /opt/teen/uploads/ (see infra/nginx/*.conf), and
// admin-service already writes manually-uploaded avatars to this same folder —
// downloaded photos land beside them so both are served identically.
const AVATAR_DIR = process.env.CRICKET_AVATAR_UPLOAD_DIR || '/opt/teen/uploads/cricket-avatars'
const AVATAR_PUBLIC_PREFIX = '/uploads/cricket-avatars'
// Avatars render at 44px in the app and ~32px in the admin table; 400px covers
// both at 3x density with room for a larger profile view later.
const AVATAR_WIDTH_PX = 400

export type PlayerProfile = {
  wikidataId?: string
  imageUrl?: string
  dateOfBirth?: string
  battingStyle?: string
  bowlingStyle?: string
  imageCredit?: string
  imageSourceUrl?: string
}

async function getJson(url: string, params: Record<string, string>, accept?: string): Promise<any> {
  const qs = new URLSearchParams(params).toString()
  const res = await fetch(`${url}?${qs}`, {
    headers: { 'User-Agent': UA, ...(accept ? { Accept: accept } : {}) },
  })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return res.json()
}

function firstValue(binding: any, key: string): string | undefined {
  const v = binding?.[key]?.value
  return typeof v === 'string' && v.length ? v : undefined
}

// Stage 1 — Wikidata. Matches on the exact English label plus "occupation:
// cricketer" so we don't pick up an unrelated person who happens to share a
// name. SAMPLE + GROUP BY collapses players who have several photos on file
// into one row (Yuvraj Singh returns four otherwise).
async function fromWikidata(name: string): Promise<PlayerProfile> {
  const escaped = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const query = `
    SELECT ?p (SAMPLE(?img) AS ?image) (SAMPLE(?dob) AS ?born)
           (SAMPLE(?batLabel) AS ?bat) (SAMPLE(?bowlLabel) AS ?bowl) WHERE {
      ?p rdfs:label "${escaped}"@en ; wdt:P106 wd:${CRICKETER_QID} .
      OPTIONAL { ?p wdt:P18 ?img }
      OPTIONAL { ?p wdt:P569 ?dob }
      OPTIONAL { ?p wdt:P741 ?bt . ?bt rdfs:label ?batLabel FILTER(lang(?batLabel) = "en") }
      OPTIONAL { ?p wdt:P5126 ?bw . ?bw rdfs:label ?bowlLabel FILTER(lang(?bowlLabel) = "en") }
    } GROUP BY ?p LIMIT 1`

  const data = await getJson(SPARQL, { query, format: 'json' }, 'application/sparql-results+json')
  const b = data?.results?.bindings?.[0]
  if (!b) return {}

  const entity = firstValue(b, 'p')
  const dob = firstValue(b, 'born')
  return {
    wikidataId: entity ? entity.split('/').pop() : undefined,
    imageUrl: firstValue(b, 'image'),
    // Wikidata returns a full xsd:dateTime; the column is a DATE.
    dateOfBirth: dob ? dob.slice(0, 10) : undefined,
    battingStyle: firstValue(b, 'bat'),
    bowlingStyle: firstValue(b, 'bowl'),
  }
}

// Stage 2 — Wikipedia page image. Wikidata's P18 is missing for a meaningful
// slice of current players (Shubman Gill, for one) even though their Wikipedia
// article carries an infobox photo, so this covers the gap.
async function imageFromWikipedia(name: string): Promise<string | undefined> {
  const data = await getJson('https://en.wikipedia.org/w/api.php', {
    action: 'query', titles: name, prop: 'pageimages', piprop: 'original',
    format: 'json', redirects: '1', origin: '*',
  })
  const pages = data?.query?.pages || {}
  for (const page of Object.values<any>(pages)) {
    const src = page?.original?.source
    if (typeof src === 'string' && src.length) return src
  }
  return undefined
}

// Commons photos are CC-licensed; the licence and the photographer must be
// retained so the app can display attribution. Best-effort — a missing credit
// must not block the rest of the enrichment.
async function fetchImageCredit(imageUrl: string): Promise<{ credit?: string; sourceUrl?: string }> {
  const filename = decodeURIComponent(imageUrl.split('/').pop() || '')
  if (!filename) return {}
  const sourceUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(filename)}`
  try {
    const data = await getJson('https://commons.wikimedia.org/w/api.php', {
      action: 'query', titles: `File:${filename}`, prop: 'imageinfo',
      iiprop: 'extmetadata', format: 'json', origin: '*',
    })
    const pages = data?.query?.pages || {}
    for (const page of Object.values<any>(pages)) {
      const meta = page?.imageinfo?.[0]?.extmetadata
      if (!meta) continue
      // Artist is HTML (usually an <a> to the uploader) — strip tags for storage.
      const artist = String(meta.Artist?.value || '').replace(/<[^>]*>/g, '').trim()
      const licence = String(meta.LicenseShortName?.value || '').trim()
      const credit = [artist, licence].filter(Boolean).join(' / ')
      return { credit: credit || undefined, sourceUrl }
    }
  } catch {
    // Credit lookup is advisory; fall through with just the source page URL.
  }
  return { sourceUrl }
}

// Download once and re-host. Hotlinking Commons means a file rename upstream
// silently breaks every avatar in the app, and points mobile traffic at
// Wikimedia's servers rather than ours.
export async function downloadAvatar(imageUrl: string, playerId: string): Promise<string | null> {
  // Commons originals are print-resolution — one squad photo measured 687 KB,
  // which is absurd for a 44px avatar on a mobile data connection. Special:FilePath
  // resizes server-side, and works for both the Wikidata (Special:FilePath/...)
  // and Wikipedia (upload.wikimedia.org/...) URL shapes because both end in the
  // Commons filename. Fall back to the original URL if the thumbnail 404s.
  const sourceFilename = imageUrl.split('/').pop() || ''
  const thumbUrl = sourceFilename
    ? `https://commons.wikimedia.org/wiki/Special:FilePath/${sourceFilename}?width=${AVATAR_WIDTH_PX}`
    : imageUrl

  let res = await fetch(thumbUrl, { headers: { 'User-Agent': UA } })
  if (!res.ok && thumbUrl !== imageUrl) {
    res = await fetch(imageUrl, { headers: { 'User-Agent': UA } })
  }
  if (!res.ok) return null

  const contentType = res.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) return null
  const ext = contentType.includes('png') ? 'png'
    : contentType.includes('svg') ? 'svg'
    : contentType.includes('webp') ? 'webp' : 'jpg'

  fs.mkdirSync(AVATAR_DIR, { recursive: true })
  const filename = `${playerId}.${ext}`
  fs.writeFileSync(path.join(AVATAR_DIR, filename), Buffer.from(await res.arrayBuffer()))
  // Cache-bust: the filename is stable per player, so a re-sync that fetches a
  // newer photo would otherwise keep serving the cached old one to clients.
  return `${AVATAR_PUBLIC_PREFIX}/${filename}?v=${Date.now()}`
}

export async function resolvePlayerProfile(name: string): Promise<PlayerProfile> {
  let profile: PlayerProfile = {}
  try {
    profile = await fromWikidata(name)
  } catch {
    // Wikidata unreachable or the query timed out — still try Wikipedia below.
  }

  if (!profile.imageUrl) {
    try {
      profile.imageUrl = await imageFromWikipedia(name)
    } catch {
      // No image from either source; the player keeps whatever avatar they have.
    }
  }

  if (profile.imageUrl) {
    const { credit, sourceUrl } = await fetchImageCredit(profile.imageUrl)
    profile.imageCredit = credit
    profile.imageSourceUrl = sourceUrl
  }
  return profile
}

export type EnrichResult = {
  processed: number
  updated: number
  imagesDownloaded: number
  notFound: string[]
}

/**
 * Enrich stored players from Wikidata/Wikipedia.
 *
 * Only ever fills columns that are currently empty (COALESCE on write), so an
 * admin's manual correction is never overwritten by a later re-run. Pass
 * `force` to re-fetch a specific player outright.
 */
export async function enrichPlayers(
  db: Pool,
  opts: { playerId?: string; teamName?: string; force?: boolean } = {},
): Promise<EnrichResult> {
  const result: EnrichResult = { processed: 0, updated: 0, imagesDownloaded: 0, notFound: [] }

  const where: string[] = []
  const params: any[] = []
  if (opts.playerId) { params.push(opts.playerId); where.push(`id = $${params.length}`) }
  if (opts.teamName) { params.push(opts.teamName); where.push(`team_name = $${params.length}`) }
  // Without `force`, skip anyone already resolved so repeat runs stay cheap.
  if (!opts.force && !opts.playerId) where.push('enriched_at IS NULL')

  const rows = (await db.query(
    `SELECT id, name, avatar_url FROM cricket_fantasy_players
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name ASC`,
    params,
  )).rows

  for (const player of rows) {
    result.processed++
    let profile: PlayerProfile
    try {
      profile = await resolvePlayerProfile(player.name)
    } catch {
      result.notFound.push(player.name)
      continue
    }

    if (!profile.wikidataId && !profile.imageUrl) {
      result.notFound.push(player.name)
      continue
    }

    // Replace the avatar when we found a real photo and the player either has
    // none or is still on the DiceBear cartoon placeholder that sync-squad
    // writes. A hand-uploaded avatar (anything under /uploads/) is left alone
    // unless the caller forced a refresh.
    let avatarUrl: string | null = null
    const placeholder = !player.avatar_url || String(player.avatar_url).includes('dicebear.com')
    if (profile.imageUrl && (placeholder || opts.force)) {
      try {
        avatarUrl = await downloadAvatar(profile.imageUrl, player.id)
        if (avatarUrl) result.imagesDownloaded++
      } catch {
        // Image fetch failed; keep the textual profile fields we did resolve.
      }
    }

    await db.query(
      `UPDATE cricket_fantasy_players SET
         wikidata_id      = COALESCE($1, wikidata_id),
         batting_style    = COALESCE($2, batting_style),
         bowling_style    = COALESCE($3, bowling_style),
         date_of_birth    = COALESCE($4::date, date_of_birth),
         image_credit     = COALESCE($5, image_credit),
         image_source_url = COALESCE($6, image_source_url),
         avatar_url       = COALESCE($7, avatar_url),
         enriched_at      = NOW()
       WHERE id = $8`,
      [
        profile.wikidataId ?? null, profile.battingStyle ?? null, profile.bowlingStyle ?? null,
        profile.dateOfBirth ?? null, profile.imageCredit ?? null, profile.imageSourceUrl ?? null,
        avatarUrl, player.id,
      ],
    )
    result.updated++

    // Pace requests — these endpoints are free and unmetered but shared.
    await new Promise(r => setTimeout(r, 250))
  }

  return result
}
