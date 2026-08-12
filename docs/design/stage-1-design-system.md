# Stage 1 catalog and identity design system

Stage 1 extends the Stage 0 visual foundation into a usable product and identity
surface. It does not introduce cart, checkout, orders, refunds, or an admin
business console.

## Visual direction

- Preserve true white, near-black `#080a0f`, graphite `#555b66`, cool rules
  `#d7dbe2`, cobalt `#0757ff`, and teal `#08ae8c`.
- Use an editorial catalog composition: large compact headings, technical mono
  labels, rule-separated product cells, and controlled pastel identifier fields.
- Keep corners restrained and avoid generic floating-card dashboards.
- Use original code-native SVG product symbols; no provider or payment-network
  trademark imagery appears in Stage 1.

## Page inventory

- Public catalog with loading, error, empty, and populated states.
- Public product detail with missing-product state.
- Registration and login forms with explicit labels, autocomplete semantics,
  disabled/loading behavior, and live errors.
- Protected account identity view.
- API-backed admin boundary verifier for 401, 403, error, and granted states.
- Stage 0 runtime map retained at `/system`.

## Accessibility and responsive behavior

- A keyboard-visible skip link is the first focus target.
- Pages use one `h1`, a named primary navigation, semantic main content, form
  labels, status regions, and visible focus indicators.
- Reduced-motion preferences collapse all nonessential transitions.
- Verified at 320, 768, 1024, and 1440 pixels with no horizontal overflow.

## Visual QA captures

- `stage-1-catalog-desktop.png` — 1440px desktop catalog.
- `stage-1-catalog-mobile.png` — 320px mobile catalog.
