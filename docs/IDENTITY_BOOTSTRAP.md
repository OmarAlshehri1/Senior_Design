# Initial administrator provisioning

Migration 013 creates every Auth user's application profile as `DISABLED` with the default `AUDITOR` role. It does not elect or activate an administrator. Before enabling authenticated operations, the owner of the Supabase project must provision the first administrator manually in the Supabase dashboard and SQL editor.

1. Create the owner-controlled administrator account in Supabase Auth and complete its invitation or password setup.
2. Verify that the Auth user has a matching row in `public.user_profiles` with `account_status = 'DISABLED'`. Copy that user's verified UUID and email from the Supabase dashboard; never place real values in source control.
3. As the database owner, run the following targeted statement with those verified values substituted. Confirm that exactly the intended row is returned as `ADMIN` and `ACTIVE`:

```sql
update public.user_profiles
set role = 'ADMIN', account_status = 'ACTIVE', status_reason = null,
    disabled_at = null, updated_at = clock_timestamp()
where id = '<verified-auth-user-uuid>'
  and email = lower('<owner-controlled-email>')
  and account_status = 'DISABLED'
returning id, email, role, account_status;
```

If the statement returns no row or more than one row, stop and verify the account identity before proceeding. Do not enable sign-ups or assign the initial role through a public API. Afterward, the first Admin can review access requests and assign roles through the application. A database owner must repeat this process only through an explicitly reviewed operational procedure if no active Admin remains.

This is a manual operational prerequisite, not an automated or live action performed by this repository change. Migration 013 remains local and isolated-test-only until its separate live-application approval.
