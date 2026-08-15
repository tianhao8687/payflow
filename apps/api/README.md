# PayFlow API

NestJS application for the PayFlow modular monolith. Through Stage 11 it owns
auth/RBAC, products, server-priced orders, provider-neutral Stripe/PayPal/Alipay
payments and refunds, exact-body webhook verification, durable inbox writes,
durable Inbox receipt, ADMIN queue inspection, health, Swagger, and the uniform error
envelope, structured request logs, traces, and API metrics. Business webhook
effects run in `apps/worker`. See the repository root
README for setup and acceptance commands.
