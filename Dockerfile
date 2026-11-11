FROM node:22-alpine

# ffmpeg + libwebp tools: conversions/stickers.  yt-dlp: all media downloads (runs locally).
RUN apk add --no-cache ffmpeg libwebp-tools python3 py3-pip make g++ && pip install --no-cache-dir --break-system-packages -U yt-dlp

WORKDIR /kamran

COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# your own code, copied from this folder (nothing is cloned from the internet)
COPY . .
RUN mkdir -p temp

CMD ["npm", "start"]
