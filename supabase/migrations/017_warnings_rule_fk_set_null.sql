-- Fix rule deletion.
--
-- warnings.rule_id referenced rules(id) with the default ON DELETE NO ACTION, so deleting a rule
-- that ANY warning pointed at failed with a foreign-key violation — the delete silently 500'd. The
-- UI has always promised "warnings using this rule remain but the rule reference is lost", which is
-- exactly ON DELETE SET NULL. (warning_suggestions.rule_id already uses SET NULL, see migration 016.)
ALTER TABLE warnings DROP CONSTRAINT IF EXISTS warnings_rule_id_fkey;
ALTER TABLE warnings ADD CONSTRAINT warnings_rule_id_fkey
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE SET NULL;
