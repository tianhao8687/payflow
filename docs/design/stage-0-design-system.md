# Stage 0 bootstrap design system

The approved concept is `stage-0-bootstrap-concept.png`. It covers only the
bootstrap landing screen and intentionally excludes Stage 1+ product, order,
payment, refund, and admin functionality.

## Visual tokens

- Background: true white `#ffffff`.
- Primary text: near black `#080a0f`.
- Muted text: graphite `#555b66`.
- Rules: cool gray `#d7dbe2`.
- Primary accent: cobalt `#0757ff`.
- Success accent: teal `#08ae8c`.
- Content typography: Arial/Helvetica grotesk stack.
- Technical labels: system monospace stack.
- Corners: restrained 7-12 px radii; no page-level rounded container.
- Layout: open two-column hero, one technical flow, one divider-based readiness
  rail, quiet footer.

## Component inventory

- Original geometric PayFlow mark and wordmark.
- One primary anchor button with hover, active, and keyboard focus states.
- Four reusable flow nodes with code-native SVG line icons.
- Four reusable readiness items separated by rules rather than cards.
- A client-side health probe that reflects the real NestJS/PostgreSQL status.

## Responsive behavior

- Desktop retains the concept's two-column composition and four-step flow.
- Tablet and mobile stack the hero content, use a two-column flow, and collapse
  the readiness rail to two columns and then one column without horizontal
  overflow.
- Motion is limited to interaction feedback and respects
  `prefers-reduced-motion`.
