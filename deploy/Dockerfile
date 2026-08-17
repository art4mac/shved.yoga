# Образ для one-shot content-sync: збирає Astro й несе готовий вміст плюс
# nginx.conf у хостовий вебрут. Відрізняється від канонічного патерну лише тим,
# що в репозиторії лежить не готова статика, а джерело, яке треба збудувати.

# --- build ---
FROM node:22-alpine AS build
WORKDIR /app

COPY site/package.json site/package-lock.json ./
RUN npm ci

COPY site/ ./

# Astro запікає SITE_URL і PUBLIC_* у canonical, og:url та sitemap на етапі
# збірки, тому це build-args, а не runtime env.
ARG SITE_URL
ARG PUBLIC_BOT_URL
ARG PUBLIC_GA4_ID
ENV SITE_URL=$SITE_URL \
    PUBLIC_BOT_URL=$PUBLIC_BOT_URL \
    PUBLIC_GA4_ID=$PUBLIC_GA4_ID
RUN npm run build

# --- carrier ---
FROM alpine:3.20
RUN apk add --no-cache rsync
WORKDIR /src
COPY --from=build /app/dist/ ./site/
COPY deploy/nginx.conf ./nginx.conf
