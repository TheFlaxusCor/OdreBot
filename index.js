const { Client, LocalAuth, MessageTypes, MessageMedia } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let qrData = null;
let botReady = false;
let ultimaActividad = Date.now();
const mensajesProcesados = new Set();
let descargasActivas = 0; 
const MAX_DESCARGAS = 2;
const botMessagesIgnoreList = new Set();
const authDir = path.join(__dirname, '.wwebjs_auth');
const cacheDir = path.join(__dirname, '.wwebjs_cache');

// ==========================================
// 🛡️ ESCUDO INTELIGENTE (FAIL-FAST)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = String(reason).toLowerCase();
    if (
        errorMsg.includes('target closed') ||
        errorMsg.includes('session closed') ||
        errorMsg.includes('execution context was destroyed') ||
        errorMsg.includes('browser has disconnected') ||
        errorMsg.includes('protocol error')
    ) {
        console.error('\n💀 [CRÍTICO] Chromium colapsó. Forzando reinicio vía PM2...\n');
        process.exit(1);
    } else {
        console.error('⚠️ Promesa rechazada (ignorada):', reason);
    }
});

process.on('uncaughtException', (err) => {
    console.error('💥 Error no capturado:', err.message);
    if (
        err.message.includes('target closed') ||
        err.message.includes('browser has disconnected')
    ) {
        process.exit(1);
    }
});

// ==========================================
// 🧹 LIMPIEZA ANTES DE INICIAR
// ==========================================
function aniquilarCache() {
    if (fs.existsSync(cacheDir)) {
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log('🗑️  Caché de Chromium purgada.');
        } catch (err) {}
    }
    if (!fs.existsSync(authDir)) return;
    try {
        fs.readdirSync(authDir).forEach(archivo => {
            const ruta = path.join(authDir, archivo);
            if (!fs.lstatSync(ruta).isDirectory()) {
                if (archivo.includes('Lock') || archivo.includes('Cookie')) {
                    fs.unlinkSync(ruta);
                }
            }
        });
    } catch (err) {}
}

aniquilarCache();

console.log('\n🤖 INICIANDO BOT EN MODO SUPERVIVENCIA\n');

// ==========================================
// 🛠️ FUNCIÓN AUXILIAR: TIMEOUT PARA PROMESAS
// ==========================================
const promesaConTimeout = (promesa, tiempoMs) => {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('TIMEOUT_EXCEDIDO')), tiempoMs);
    });
    return Promise.race([promesa, timeout]).finally(() => clearTimeout(timeoutId));
};

// ==========================================
// 🛠️ CLIENTE OPTIMIZADO PARA BAJA RAM
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--no-first-run',
            '--disable-software-rasterizer',
            '--disable-gl-drawing-for-tests',
            '--disk-cache-size=52428800',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--safebrowsing-disable-auto-update',
            '--disable-images',
            '--blink-settings=imagesEnabled=false',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        protocolTimeout: 300000
    }
});

// ==========================================
// 🆕 WATCHDOG: Detecta bot zombie
// ==========================================
const WATCHDOG_INTERVALO = 5 * 60 * 1000; 
const WATCHDOG_TIMEOUT   = 30 * 60 * 1000; 

setInterval(() => {
    const inactividad = Date.now() - ultimaActividad;
    mensajesProcesados.clear();
    console.log(`🧹 Set limpiado. Inactividad: ${Math.round(inactividad / 60000)} min`);

    if (botReady && inactividad > WATCHDOG_TIMEOUT) {
        console.error('💀 [WATCHDOG] Bot zombie detectado. Reiniciando...');
        process.exit(1);
    }
}, WATCHDOG_INTERVALO);

// ==========================================
// PROCESAR MENSAJE (VERSIÓN ALTO RENDIMIENTO)
// ==========================================
async function procesarMensaje(msg) {
    try {
        if (msg.from === 'status@broadcast') return;

        // 🚀 FIX 1: IGNORAR HISTORIAL ANTIGUO
        const antiguedadSegundos = Math.floor(Date.now() / 1000) - msg.timestamp;
        if (antiguedadSegundos > 60) return;

        const chatId = msg.fromMe ? msg.to : msg.from;
        const ignoreKey = `${chatId}_${msg.body || ''}`;
        
        // 🚀 FIX 2: CONTROL DE ECOS VS HUMANOS
        if (msg.fromMe) {
            if (botMessagesIgnoreList.has(ignoreKey)) {
                botMessagesIgnoreList.delete(ignoreKey);
                console.log(` 🔇 [BOT] Eco de respuesta ignorado.`);
                return; 
            } else {
                console.log(` 👤 [HUMANO] Mensaje enviado manualmente. Procesando hacia FastAPI...`);
            }
        }

        const idUnico = msg.id._serialized;
        if (mensajesProcesados.has(idUnico)) return;
        mensajesProcesados.add(idUnico);

        ultimaActividad = Date.now();
        console.log(`\n📨 Mensaje NUEVO detectado en ${chatId} [Tipo: ${msg.type}]`);

        const tiposPermitidos = [MessageTypes.TEXT, 'chat', MessageTypes.DOCUMENT];
        if (!tiposPermitidos.includes(msg.type)) return;

        // 🚀 FIX 3: EXTRACCIÓN RÁPIDA DE CONTACTO
        let chatName = "Desconocido";
        try {
            const contact = await msg.getContact();
            chatName = contact.name || contact.pushname || contact.number || "Desconocido";
        } catch (e) {
            console.log(" ⚠️ Nombre de contacto no disponible.");
        }

        const baseUrl = process.env.BACKEND_URL || 'https://backend-odrekao.fastapicloud.dev';
        const apiKey = process.env.BOT_API_KEY || 'odrekao_super_secreto';
        
        let targetUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/webhook`;
        let fetchOptions = {
            method: 'POST',
            headers: { 'x-api-key': apiKey }
        };

        let isDocument = msg.hasMedia && msg.type === MessageTypes.DOCUMENT;
        
        if (isDocument) {
            if (descargasActivas >= MAX_DESCARGAS) {
                botMessagesIgnoreList.add(`${chatId}_⏳ El sistema está muy concurrido procesando otros archivos. Por favor, intenta enviar tu documento en un minuto.`);
                await msg.reply("⏳ El sistema está muy concurrido procesando otros archivos. Por favor, intenta enviar tu documento en un minuto.");
                return;
            }

            descargasActivas++;
            console.log(`📥 Descargando adjunto...`);

            try {
                const media = await promesaConTimeout(msg.downloadMedia(), 45000);

                if (!media || media.mimetype !== 'application/pdf') {
                    botMessagesIgnoreList.add(`${chatId}_⚠️ Por razones de compatibilidad, el sistema médico solo acepta archivos en formato PDF.`);
                    await msg.reply("⚠️ Por razones de compatibilidad, el sistema médico solo acepta archivos en formato PDF.");
                    descargasActivas--;
                    return;
                }

                const formData = new FormData();
                formData.append('from_id', chatId); 
                formData.append('chat_name', chatName);
                formData.append('body', msg.body || ''); 
                formData.append('timestamp', msg.timestamp);

                const buffer = Buffer.from(media.data, 'base64');
                const blob = new Blob([buffer], { type: media.mimetype });
                formData.append('file', blob, media.filename || 'documento.pdf');

                fetchOptions.body = formData;
                targetUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/upload/pdf-whatsapp`; 

            } catch (error) {
                console.error("❌ Error procesando el PDF:", error.message);
                botMessagesIgnoreList.add(`${chatId}_❌ Ocurrió un error al procesar tu archivo. Inténtalo de nuevo.`);
                await msg.reply("❌ Ocurrió un error al procesar tu archivo. Inténtalo de nuevo.");
                descargasActivas--; 
                return;
            }
            
            descargasActivas--;
            console.log(`✅ Archivo preparado. Enviando a FastAPI...`);

        } else {
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({
                from_id: chatId,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                chat_name: chatName
            });
        }

        const controller = new AbortController();
        const timeoutDuration = isDocument ? 45000 : 15000; 
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
        fetchOptions.signal = controller.signal;

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`⚠️ Error del backend: ${response.status} ${response.statusText}`);
            return;
        }

        const data = await response.json();

        // 🚀 FIX 4: ENVÍO DIRECTO (IMAGEN LOCAL DESDE EL DISCO DURO)
        if (data.enviar_imagen) {
            try {
                // Ruta absoluta buscando "logo.png" junto a index.js
                const rutaImagenLocal = path.join(__dirname, 'logo.png');

                if (fs.existsSync(rutaImagenLocal)) {
                    console.log(`🖼️ Cargando imagen al instante desde disco duro local (logo.png)...`);
                    const mediaImg = MessageMedia.fromFilePath(rutaImagenLocal);
                    
                    botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
                    await client.sendMessage(chatId, mediaImg, { caption: data.texto });
                    console.log(`    ✅ Panel de bienvenida enviado (Local).`);
                } 
                else if (data.imagen_url) {
                    // PLAN B: Si la imagen local no existe, intenta descargarla desde el backend
                    console.log(`⚠️ logo.png no encontrado localmente. Descargando vía Node: ${data.imagen_url}`);
                    const resImg = await fetch(data.imagen_url);
                    const buffer = await resImg.arrayBuffer();
                    const base64Data = Buffer.from(buffer).toString('base64');
                    const mediaImg = new MessageMedia('image/png', base64Data, 'logo.png');
                    
                    botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
                    await client.sendMessage(chatId, mediaImg, { caption: data.texto });
                    console.log(`    ✅ Panel de bienvenida enviado (Descargado).`);
                } else {
                    // Si no hay imagen local ni URL enviada por el backend, responde con texto plano
                    botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
                    await msg.reply(data.texto);
                }
            } catch (imgError) {
                console.error(`❌ Error procesando imagen:`, imgError.message);
                botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
                await msg.reply(data.texto);
            }
        } 
        else if (data.responder && data.texto) {
            botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
            await msg.reply(data.texto);
            console.log(`    ✅ Respuesta enviada.`);
        }

        if (data.enviar_documento && data.documento_url) {
            try {
                console.log(`📥 Descargando documento remoto...`);
                const mediaDoc = await promesaConTimeout(MessageMedia.fromUrl(data.documento_url, { unsafeMimeTypes: true }), 60000);
                if (data.documento_nombre) {
                    mediaDoc.filename = data.documento_nombre;
                }
                await client.sendMessage(chatId, mediaDoc);
                console.log(`    ✅ Documento transmitido exitosamente.`);
            } catch (docError) {
                console.error(`❌ Error transmitiendo documento:`, docError.message);
            }
        }

    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error("❌ Error general procesando el mensaje:", error);
        }
    }
} 

// ==========================================
// EVENTOS
// ==========================================
client.on('qr', qr => {
    qrData = qr;
    ultimaActividad = Date.now();
    console.clear();
    console.log('\n🔐 ESCANEA EL CÓDIGO QR 👇\n');
    qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
    ultimaActividad = Date.now();
    qrData = null;
});

client.on('message_create', async msg => { await procesarMensaje(msg); });

client.on('ready', () => {
    botReady = true;
    ultimaActividad = Date.now();
    console.log('\n✅ ¡BOT EN LÍNEA Y OPTIMIZADO!\n');
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log(`\n⚠️  Desconectado: ${reason}`);
    process.exit(1);
});

// ==========================================
// ENDPOINTS
// ==========================================
app.get('/qr', async (req, res) => {
    if (!qrData) return res.send(`<h2>✅ Autenticado</h2>`);
    try {
        const qrImg = await qrcode.toDataURL(qrData);
        res.send(`<div style="text-align:center;"><img src="${qrImg}"><p>Escanea</p></div>`);
    } catch (err) {
        res.status(500).send('Error generando QR');
    }
});

app.get('/status', (req, res) => res.json({
    botReady,
    autenticado: client.info ? true : false,
    inactividadMinutos: Math.round((Date.now() - ultimaActividad) / 60000)
}));

app.post('/notificar', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'Bot no listo' });
    try {
        await client.sendMessage(req.body.to, req.body.mensaje);
        ultimaActividad = Date.now();
        res.json({ status: 'Enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

console.log('📱 Inicializando cliente...\n');
client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Puerto ${PORT} activo\n`));