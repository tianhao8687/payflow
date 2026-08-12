# syntax=docker/dockerfile:1

FROM node:24-alpine

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN corepack enable && corepack prepare pnpm@11.16.0 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN --mount=type=cache,id=payflow-pnpm-store,target=/pnpm/store,sharing=locked \
  pnpm install \
    --fetch-retries=5 \
    --fetch-timeout=120000 \
    --frozen-lockfile \
    --network-concurrency=8 \
    --store-dir=/pnpm/store

COPY . .

RUN pnpm --filter @payflow/web build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["pnpm", "--filter", "@payflow/web", "start"]
