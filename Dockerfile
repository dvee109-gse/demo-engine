# Playwright's official image ships Chromium + all the OS-level libraries it
# needs pre-installed — avoids fighting apt dependencies on a bare Node image.
# Tag must match the installed npm package version (node_modules/playwright).
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
