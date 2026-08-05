-- Phase 4a: long-form fields → Json ReportBlock[]; DailyLog flaggedTickers → text[].
-- Idempotent where prior failed attempt already converted some DailyLog columns.

-- ---------------------------------------------------------------------------
-- Helper: wrap text column → jsonb ReportBlock[] (no-op if already jsonb)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  col text;
  cols text[] := ARRAY[
    'marketContext', 'topNews', 'portfolioMove', 'watchlistMove', 'actionTaken', 'notes'
  ];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'DailyLog'
        AND column_name = col AND udt_name = 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE "DailyLog" ALTER COLUMN %I TYPE JSONB USING (
          CASE
            WHEN %I IS NULL OR btrim(%I) = '''' THEN NULL
            ELSE jsonb_build_array(jsonb_build_object(''type'', ''paragraph'', ''text'', %I))
          END
        )',
        col, col, col, col
      );
    END IF;
  END LOOP;
END $$;

-- flaggedTickers: text → text[] via swap (ALTER ... USING cannot use ARRAY subquery)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DailyLog'
      AND column_name = 'flaggedTickers' AND udt_name = 'text'
  ) THEN
    ALTER TABLE "DailyLog" ADD COLUMN "flaggedTickers_new" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
    UPDATE "DailyLog"
    SET "flaggedTickers_new" = CASE
      WHEN "flaggedTickers" IS NULL OR btrim("flaggedTickers") = '' THEN ARRAY[]::TEXT[]
      WHEN "flaggedTickers" ~ '[,;]' THEN COALESCE(
        (
          SELECT array_agg(trim(x) ORDER BY ord)
          FROM unnest(regexp_split_to_array("flaggedTickers", '[,;]+')) WITH ORDINALITY AS t(x, ord)
          WHERE trim(x) <> ''
        ),
        ARRAY[]::TEXT[]
      )
      WHEN btrim("flaggedTickers") ~ '^[A-Z][A-Z0-9.]{0,5}(\s+[A-Z][A-Z0-9.]{0,5})+$' THEN
        regexp_split_to_array(btrim("flaggedTickers"), '\s+')
      ELSE ARRAY[btrim("flaggedTickers")]
    END;
    ALTER TABLE "DailyLog" DROP COLUMN "flaggedTickers";
    ALTER TABLE "DailyLog" RENAME COLUMN "flaggedTickers_new" TO "flaggedTickers";
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DailyLog'
      AND column_name = 'flaggedTickers' AND udt_name = '_text'
  ) THEN
    -- already text[]
    NULL;
  ELSE
    ALTER TABLE "DailyLog" ADD COLUMN "flaggedTickers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
  END IF;
END $$;

ALTER TABLE "DailyLog" ALTER COLUMN "flaggedTickers" SET DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DailyLog" ALTER COLUMN "flaggedTickers" SET NOT NULL;

ALTER TABLE "DailyLog" DROP COLUMN IF EXISTS "flagsCount";

ALTER TABLE "DailyLog" ALTER COLUMN "alertEmailSent" SET DEFAULT false;

ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "rulesVersion" TEXT;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Generic text → jsonb paragraph wrap for other tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('Portfolio', 'thesis'),
      ('Portfolio', 'notes'),
      ('Portfolio', 'pageNotes'),
      ('Watchlist', 'thesis'),
      ('Watchlist', 'actionNotes'),
      ('Watchlist', 'pageNotes'),
      ('Trade', 'thesisAtEntry'),
      ('Trade', 'notes'),
      ('Trend', 'avoidReason'),
      ('Trend', 'notes'),
      ('Trend', 'retrospective'),
      ('Idea', 'whyInteresting'),
      ('Idea', 'notes')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.tbl
        AND column_name = r.col AND udt_name = 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE JSONB USING (
          CASE
            WHEN %I IS NULL OR btrim(%I) = '''' THEN NULL
            ELSE jsonb_build_array(jsonb_build_object(''type'', ''paragraph'', ''text'', %I))
          END
        )',
        r.tbl, r.col, r.col, r.col, r.col
      );
    END IF;
  END LOOP;
END $$;
