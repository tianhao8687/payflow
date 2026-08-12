# PayFlow API

NestJS application for the PayFlow modular monolith. Through Stage 10 it owns
auth/RBAC, products, server-priced orders, provider-neutral Stripe/PayPal
payments and refunds, exact-body webhook verification, durable inbox writes,
BullMQ enqueue, ADMIN queue inspection, health, Swagger, and the uniform error
envelope, structured request logs, traces, and API metrics. Business webhook
effects run in `apps/worker`. See the repository root
README for setup and acceptance commands.
