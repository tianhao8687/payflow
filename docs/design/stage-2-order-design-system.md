# Stage 2 cart and order design extension

Stage 2 preserves the Stage 1 editorial catalog system and adds transactional
surfaces without introducing payment-provider branding.

## Page inventory

- Persistent tab-scoped cart with quantity editing, removal, clear, empty,
  unauthenticated, submitting, and API-error states.
- Customer order history with loading, error, empty, and populated states.
- Owned order detail with immutable snapshots, server total, pending
  cancellation, missing/foreign-resource, and cancelled states.

## Interaction and trust cues

- Browser totals are explicitly labelled estimates; the accepted total is
  labelled `Server total` only after the API responds.
- Destructive cancellation uses a restrained red outline and appears only for
  `PENDING_PAYMENT`.
- Status is expressed by text and color, never color alone.
- Desktop item snapshots use a semantic table. Below 640px, the same data uses
  labelled description-list cards so all money columns remain visible without
  horizontal scrolling.

## Accessibility and responsive verification

- Semantic headings, lists, table headers, labels, status/alert regions, and
  visible keyboard focus remain in force.
- The skip link remains the first focus target.
- Catalog, cart, and order detail were verified at 320, 768, 1024, and 1440
  pixels with no page overflow.
- Complete registration, add-to-cart, order creation, cancellation, and order
  history flow produced no console errors or uncaught page errors.

## Visual QA captures

- `stage-2-order-detail-desktop.png` — 1440px pending order detail.
- `stage-2-order-detail-mobile.png` — 320px cancelled order detail with full
  item pricing visible.
