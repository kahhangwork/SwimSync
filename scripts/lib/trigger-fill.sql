-- Used by scripts/check-db-overrides.sh (TRIGGER_FILLED_COLUMNS). Run with
--   psql -v tbl=<table> -v col=<column>
-- Prints ok | no-column | nullable | no-trigger for public.<tbl>.<col>.
--
-- Comments and string literals are stripped from each trigger body before matching,
-- so a commented-out or quoted assignment never counts, nor does `NEW.col := NULL`.
-- Only an ENABLED ('O'/'A' — not disabled, not replica-only) BEFORE INSERT ROW
-- trigger with NO `WHEN (…)` clause qualifies. This proves an assignment exists, not
-- that it is unconditional (an IF TG_OP = 'UPDATE' branch would still match) — the
-- overrides entry's citation of the body is the real proof. Known false GREENs, all
-- needing a deliberate edit: `:= (NULL)`, `:= CAST(NULL …)`, text inside E'…\'…' or
-- $tag$…$tag$ strings, nested /* /* */ */ comments. Known false REDs: `NEW.c = 1`
-- (kept red: an IF's `=` comparison looks the same), `'--'` inside a string earlier on
-- the line. Fix the entry or the trigger, never this file, when one bites.
with c as (
  select regexp_replace(regexp_replace(regexp_replace(p.prosrc,
           '/\*.*?\*/', ' ', 'g'),
           '--[^\n]*', ' ', 'g'),
           '''([^'']|'''')*''', ' ', 'g') as src
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = to_regclass('public.' || :'tbl') and not t.tgisinternal
     and t.tgenabled in ('O', 'A') and t.tgqual is null
     and (t.tgtype & 7) = 7          -- ROW | BEFORE | INSERT
)
select case
  when not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || :'tbl')
                     and a.attname = :'col' and a.attnum > 0 and not a.attisdropped) then 'no-column'
  when not (select a.attnotnull from pg_attribute a where a.attrelid = to_regclass('public.' || :'tbl')
              and a.attname = :'col') then 'nullable'
  when exists (select 1 from c
                where c.src ~* ('(^|[^a-z_.])new\.' || :'col' || '\s*:=\s*(?!\s|null\M)')
                   or c.src ~* ('into\s+(strict\s+)?(new\.[a-z_]+\s*,\s*)*new\.' || :'col' || '([^a-z_]|$)'))
    then 'ok'
  else 'no-trigger' end;
