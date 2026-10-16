-- EagleDocs is now StudyHawk: the names it stored move with it.

-- Daily turns on the hosted models.
ALTER TABLE usage_daily RENAME COLUMN eagledocs_messages TO studyhawk_messages;
UPDATE app_settings SET key = 'models.studyhawk_daily_messages'
WHERE key = 'models.eagledocs_daily_messages'
  AND NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'models.studyhawk_daily_messages');

-- The hosted models' refs ("eagledocs:<id>" -> "studyhawk:<id>").
UPDATE chats SET model_ref = 'studyhawk:' || substr(model_ref, 11) WHERE model_ref LIKE 'eagledocs:%';
UPDATE messages SET model_ref = 'studyhawk:' || substr(model_ref, 11) WHERE model_ref LIKE 'eagledocs:%';
UPDATE schedules SET model_ref = 'studyhawk:' || substr(model_ref, 11) WHERE model_ref LIKE 'eagledocs:%';
UPDATE user_model_prefs SET default_model_ref = 'studyhawk:' || substr(default_model_ref, 11) WHERE default_model_ref LIKE 'eagledocs:%';
UPDATE user_model_prefs SET auto_map = replace(auto_map::text, '"eagledocs:', '"studyhawk:')::jsonb WHERE auto_map::text LIKE '%"eagledocs:%';
UPDATE app_settings SET value = replace(value::text, '"eagledocs:', '"studyhawk:')::jsonb WHERE value::text LIKE '%"eagledocs:%';

-- The StudyHawk cyan is the new default look. 'eagle' was everyone's default (not a choice), so it moves too.
ALTER TABLE users ALTER COLUMN theme_skin SET DEFAULT 'hawk';
UPDATE users SET theme_skin = 'hawk' WHERE theme_skin = 'eagle';
UPDATE app_settings SET value = '"hawk"'::jsonb WHERE key = 'app.default_theme_skin' AND value = '"eagle"'::jsonb;
