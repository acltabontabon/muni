-- A display name is something the person chose, never something inferred. `name_set_at` records
-- that choice; an account without it is asked for a name after verifying (and before joining).
-- Earlier sign-ins defaulted the name to the (lowercased) email's local part, verbatim: those count
-- as not chosen. A name someone typed that differs even in case counts as theirs.
ALTER TABLE accounts ADD COLUMN name_set_at INTEGER;
UPDATE accounts SET name_set_at = created_at
 WHERE trim(display_name) <> ''
   AND display_name <> substr(email, 1, instr(email, '@') - 1);
