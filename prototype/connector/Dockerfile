FROM ghcr.io/puppeteer/puppeteer:22
USER root
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js autopay.js ./
ENV CHROME_PATH=/usr/bin/google-chrome-stable PUPPETEER_SKIP_DOWNLOAD=true PORT=3131
EXPOSE 3131
CMD ["node","server.js"]
