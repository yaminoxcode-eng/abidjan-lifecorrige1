-- One e-mail address may be used as a recovery contact for several phone-based game accounts.
-- Phone remains the unique account identifier. Remove the old unique index (not a constraint),
-- then keep a normal lookup index for case-insensitive recovery searches.
ALTER TABLE public.game_accounts DROP CONSTRAINT IF EXISTS game_accounts_email_key;
DROP INDEX IF EXISTS public.game_accounts_email_lower_uq;
CREATE INDEX IF NOT EXISTS game_accounts_email_lower_idx
  ON public.game_accounts (lower(email));
