# 1. IMAGEN BASE
FROM node:22-bookworm-slim

# 2. INSTALAR CHROMIUM NATIVO Y TINI
RUN apt-get update && apt-get install -y \
    chromium \
    tini \                               
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. VARIABLES DE ENTORNO CRÍTICAS
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',

# 4. DIRECTORIO DE TRABAJO
WORKDIR /app

# 5. COPIAR DEPENDENCIAS
COPY package*.json ./

# 6. INSTALAR DEPENDENCIAS
RUN npm ci

# 7. COPIAR CÓDIGO
COPY . .

# 8. COMANDO DE EJECUCIÓN USANDO TINI
ENTRYPOINT ["/usr/bin/tini", "--"]     
CMD ["npm", "start"]