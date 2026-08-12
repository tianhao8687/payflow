# ADR 0004: Short-lived bearer JWT and API-enforced RBAC

- Status: Accepted
- Stage: 1

## Context

Stage 1 requires registration, login, and reliable USER/ADMIN isolation while
preserving the specified NestJS modular monolith. Later payment mutations must
not rely on browser-visible role checks.

## Decision

- Use NestJS JWT with HS256, a validated secret, a 15-minute default lifetime,
  fixed issuer `payflow-api`, and audience `payflow-web`.
- Keep claims minimal: `sub` and `role`. Never include passwords, hashes, email,
  or other profile fields in the token.
- Authenticate API routes by default with a global guard. Mark the exact public
  endpoints with `@Public()`.
- Enforce controller roles with a second global guard and `@Roles()` metadata.
- Make public registration USER-only. Create the Stage 1 ADMIN through an
  environment-driven, idempotent seed.
- Hash passwords with bcrypt cost 12 and reject inputs beyond bcrypt's 72-byte
  boundary instead of allowing silent truncation.
- Rate-limit login and registration to five requests per minute.
- Keep the browser token in tab-scoped `sessionStorage`; do not use a persistent
  cookie or `localStorage`. The API remains the authorization authority.

## Consequences

- USER/ADMIN isolation is testable at the real HTTP boundary without adding the
  Stage 5 admin feature set early.
- A stolen bearer token is usable until its short expiry, so XSS prevention and
  secret-safe logging remain essential.
- Role changes encoded in an already issued token take effect at token renewal
  or expiry; the short lifetime bounds this window.
- A production deployment must replace all sandbox secrets and may later adopt
  revocation/session infrastructure without changing the domain model.
