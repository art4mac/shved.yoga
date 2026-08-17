# --- build ---
FROM node:22-alpine AS build
WORKDIR /app

# Спершу манифест і lock — шар залежностей кешується окремо від коду
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Astro запікає SITE_URL і PUBLIC_* на етапі збірки, тому це build-args, а не runtime env
ARG SITE_URL
ARG PUBLIC_BOT_URL
ARG PUBLIC_GA4_ID
ENV SITE_URL=$SITE_URL \
    PUBLIC_BOT_URL=$PUBLIC_BOT_URL \
    PUBLIC_GA4_ID=$PUBLIC_GA4_ID
RUN npm run build

# --- runtime ---
# nginx-unprivileged: слухає 8080 і працює під користувачем nginx, не під root
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null 2>&1 || exit 1
