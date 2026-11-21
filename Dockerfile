FROM node:22-bookworm AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Build-time placeholders only. Runtime secrets come from env_file.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV APP_ENCRYPTION_KEY="1111111111111111111111111111111111111111111111111111111111111111"
ENV JWT_SECRET="build-only-secret-build-only-secret-1234"
ENV RECOVERY_PEPPER="build-only-pepper"
ENV INGEST_SECRET="build-only-ingest-secret"
ENV APP_URL="http://localhost:3000"
ENV MAIL_DOMAIN="localhost"

COPY package.json package-lock.json ./
COPY web/package.json web/
COPY shared/package.json shared/
COPY crypto/package.json crypto/
COPY db/package.json db/
COPY server/package.json server/
COPY workers/package.json workers/
RUN npm ci

COPY . .
RUN npm run db:generate
RUN npm run build

FROM node:22-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
