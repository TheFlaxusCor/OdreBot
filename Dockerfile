# 1. Usamos la versión exacta de Node que estabas usando (v22)
FROM node:22-bookworm-slim

# 2. Obligamos al sistema a instalar Chromium nativo
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. 🟢 NUEVO: Bloqueamos la descarga interna de Puppeteer para evitar errores
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4. Creamos la carpeta de trabajo
WORKDIR /app

# 5. Copiamos dependencias y hacemos la instalación limpia
COPY package*.json ./
RUN npm ci

# 6. Copiamos el resto del código
COPY . .

# 7. Encendemos el bot
CMD ["npm", "start"]