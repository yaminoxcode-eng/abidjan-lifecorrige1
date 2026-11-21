-- One e-mail address may be used as a recovery contact for several phone-based game accounts.
-- Keep phone as the unique account identifier; retain the non-unique lower(email) lookup index.
ALTER TABLE public.game_accounts DROP CONSTRAINT IF EXISTS game_accounts_email_key;
