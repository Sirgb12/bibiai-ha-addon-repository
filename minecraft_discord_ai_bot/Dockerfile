FROM ghcr.io/home-assistant/base:latest

ARG BUILD_ARCH
ARG BUILD_VERSION=1.0.0

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="addon" \
  io.hass.arch="${BUILD_ARCH}"

RUN apk add --no-cache nodejs npm ffmpeg

WORKDIR /app

COPY package*.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm ci \
  && npm run build \
  && npm prune --omit=dev

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD ["/run.sh"]
