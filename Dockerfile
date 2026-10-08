# Fitron production image. Builds on x86 and ARM (e.g. Oracle Cloud's free Ampere servers).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
COPY --from=build /app /app
RUN mkdir -p /data/storage && chown -R node:node /data /app/.next
USER node
EXPOSE 3000
# Apply any new database migrations, then start.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start"]
