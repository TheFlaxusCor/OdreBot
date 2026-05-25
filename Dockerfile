# 1. Usamos una versión oficial y ligera de Node.js en Linux
FROM node:20-bullseye-slim

# 2. Obligamos al sistema a instalar Chromium nativo y sus fuentes
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Creamos la carpeta de trabajo
WORKDIR /app

# 4. Copiamos los archivos de dependencias e instalamos
COPY package*.json ./
RUN npm ci

# 5. Copiamos el resto de tu código
COPY . .

# 6. Encendemos el bot
CMD ["npm", "start"]