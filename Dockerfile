FROM oven/bun:1

WORKDIR /app

# Separate layer from the rest of the source, so the install layer is cached
# and only re-runs when package.json/bun.lock actually change.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

CMD ["bun", "run", "index.ts"]
