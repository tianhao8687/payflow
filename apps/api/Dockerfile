# syntax=docker/dockerfile:1

FROM node:24-alpine

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/payment-core/package.json packages/payment-core/package.json
COPY packages/payment-domain/package.json packages/payment-domain/package.json
COPY packages/payment-paypal/package.json packages/payment-paypal/package.json
COPY packages/payment-queue/package.json packages/payment-queue/package.json
COPY packages/payment-stripe/package.json packages/payment-stripe/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=payflow-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install \
    --fetch-retries=5 \
    --fetch-timeout=120000 \
    --frozen-lockfile \
    --network-concurrency=8 \
    --store-dir=/pnpm/store

COPY . .

RUN pnpm db:generate \
  && pnpm --filter @payflow/shared build \
  && pnpm --filter @payflow/database build \
  && pnpm --filter @payflow/observability build \
  && pnpm --filter @payflow/payment-core build \
  && pnpm --filter @payflow/payment-domain build \
  && pnpm --filter @payflow/payment-paypal build \
  && pnpm --filter @payflow/payment-queue build \
  && pnpm --filter @payflow/payment-stripe build \
  && pnpm --filter @payflow/api build

ENV NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "pnpm db:migrate:deploy && pnpm db:seed && node apps/api/dist/main.js"]
