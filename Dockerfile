# DealScout — slim production image (eBay + HTTP scrapers).
# Facebook Marketplace (Playwright) is NOT included here to keep the image
# small; see README "Facebook" for the Playwright image variant.
FROM node:20-slim

WORKDIR /app

# Install only production deps (skip the optional Playwright download).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund

COPY src ./src
COPY public ./public

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
