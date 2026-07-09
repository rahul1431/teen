-- Migration: Clean duplicates and add unique constraint on support_kb_articles title

-- 1. Delete duplicate articles, keeping the oldest one (lowest UUID or first created)
DELETE FROM support_kb_articles a
USING support_kb_articles b
WHERE a.created_at > b.created_at
  AND a.title = b.title;

-- In case created_at is identical, tie-break with id
DELETE FROM support_kb_articles a
USING support_kb_articles b
WHERE a.id > b.id
  AND a.title = b.title;

-- 2. Add unique constraint on title
ALTER TABLE support_kb_articles ADD CONSTRAINT support_kb_articles_title_key UNIQUE (title);
