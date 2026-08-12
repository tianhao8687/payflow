# ADR 0005: Server-authoritative order pricing and immutable snapshots

- Status: Accepted
- Stage: 2

## Context

Cart contents and displayed prices are controlled by the browser and therefore
cannot be trusted. Historical orders also must not change when an operator edits
a product name or price. Stage 2 must solve both requirements while preserving
the locked NestJS modular monolith and PostgreSQL/Prisma persistence boundary.

## Decision

- Accept only product UUIDs and positive integer quantities from the client.
  Reject unknown fields through the global validation pipe.
- Reload every referenced product inside the order-creation transaction and
  calculate unit, line, subtotal, and total amounts with integer minor units.
- Aggregate duplicate product IDs and cap each product quantity at 99. Reject
  missing/inactive products, mixed currencies, insufficient stock, and amounts
  outside PostgreSQL's integer range.
- Persist `Order` and `OrderItem` rows atomically at serializable isolation.
  Copy SKU, name, and unit price into immutable item snapshot columns.
- Scope every customer order read and mutation by both order ID and JWT subject.
  Return 404 for both foreign and absent resources.
- Route all status changes through an explicit transition function. Stage 2
  permits customer cancellation only from `PENDING_PAYMENT`.
- Add database checks for ISO-style currency, positive quantity, nonnegative
  amounts, line arithmetic, and total/subtotal equality.

## Consequences

- Tampering with a browser price cannot influence an accepted order amount.
- Historical order display remains stable after product edits.
- Failed order creation leaves neither a partial order nor partial items.
- The stock check is an availability guard, not a reservation. Reservation or
  decrement behavior requires a later explicitly approved fulfillment design.
- Shipping, tax, discounts, and payment remain out of scope; therefore Stage 2
  intentionally requires `total_amount = subtotal_amount`.
