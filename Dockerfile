FROM oven/bun:latest AS web-build
WORKDIR /broadcast-box/web

# Install dependencies first so the (slow) install layer is only invalidated
# when the manifest or lockfile actually changes.
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

# vite.config.ts uses `envDir: "../"` and reads the root .env files directly,
# so they have to be present for the frontend build.
COPY .env .env.development .env.production /broadcast-box/
COPY web/ ./

# Site name is baked into the frontend at build time; defaults to
# "Broadcast Box" when unset. Set via `docker build --build-arg VITE_SITE_NAME="Your Name"`.
ARG VITE_SITE_NAME=""
ENV VITE_SITE_NAME=${VITE_SITE_NAME}
RUN bun run build

FROM golang:alpine AS go-build
WORKDIR /broadcast-box

# Download modules in their own layer so source edits don't re-fetch them.
COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
COPY internal/ ./internal/

# CGO_ENABLED=0 guarantees a fully static binary for the distroless base,
# -trimpath drops build-host paths and -s -w strips the symbol/DWARF tables.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/broadcast-box .

# distroless/static ships CA certificates (needed for the outbound webhook
# calls and the start-up network test) but no shell, package manager or Go
# toolchain, so the runtime image is just the static binary plus its assets.
FROM gcr.io/distroless/static:latest
COPY --from=web-build /broadcast-box/web/build /broadcast-box/web/build
COPY --from=go-build /out/broadcast-box /broadcast-box/broadcast-box
COPY .env.production /broadcast-box/.env.production

ENV APP_ENV=production
ENV NETWORK_TEST_ON_START=true

WORKDIR /broadcast-box
ENTRYPOINT ["/broadcast-box/broadcast-box"]
