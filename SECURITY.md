# CloudVault Security Notes

## Secrets

- Never commit `.env`, API keys, JWT secrets, or Supabase service-role keys.
- Use [`.env.example`](.env.example) as the template only (empty/placeholder values).
- Local `.env` is gitignored. Confirm with: `git check-ignore -v .env`
- Rotate any key that was ever pasted into chat, screenshots, or a committed file.

## Required secret handling

| Secret | Where it lives | Notes |
| :--- | :--- | :--- |
| `JWT_SECRET` | backend `.env` | Long random string; required |
| `MONGO_URI` | backend `.env` | May embed DB password |
| `SUPABASE_SERVICE_ROLE_KEY` | backend `.env` only | Never expose to the browser / `NEXT_PUBLIC_*` |
| `OPENROUTER_API_KEY` | backend `.env` only | Worker + API server; never frontend |

Frontend may only use public config such as `NEXT_PUBLIC_API_URL`.

## Auth cookies

- Auth token cookie is `httpOnly`, `sameSite=lax`, and `secure` in production.
- Prefer HTTPS in production so `secure` cookies are sent.

## Logging

- Request logs must not print `Authorization`, `Cookie`, `Set-Cookie`, or raw passwords.
- Do not log OpenRouter / Supabase key values (model names are OK).

## Before every push

1. `git status` — no `.env` or key files staged
2. `git diff --cached` — scan for `sk-`, `service_role`, connection strings with passwords
3. Keep `scratch/` and `*.log` out of commits

## Incident response

If a secret was pushed: revoke/rotate it immediately in the provider console, then rewrite history only if you understand the force-push impact (or treat the key as burned and rotate).
