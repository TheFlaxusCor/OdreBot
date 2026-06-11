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
        console.error('\n💀 [CRÍTICO] Chromium colapsó. Forzando reinicio...\n');
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
        try { fs.rmSync(cacheDir, { recursive: true, force: true }); } catch (err) {}
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
// 🛠️ FUNCIÓN AUXILIAR: TIMEOUT
// ==========================================
const promesaConTimeout = (promesa, tiempoMs) => {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('TIMEOUT_EXCEDIDO')), tiempoMs);
    });
    return Promise.race([promesa, timeout]).finally(() => clearTimeout(timeoutId));
};
// ==========================================
// 🛠️ CLIENTE OPTIMIZADO (PERMITIENDO IMÁGENES)
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
            // 🚨 ELIMINAMOS --disable-images y blink-settings
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        protocolTimeout: 300000
    }
});

const WATCHDOG_INTERVALO = 5 * 60 * 1000; 
const WATCHDOG_TIMEOUT   = 30 * 60 * 1000; 

setInterval(() => {
    const inactividad = Date.now() - ultimaActividad;
    mensajesProcesados.clear();
    if (botReady && inactividad > WATCHDOG_TIMEOUT) {
        console.error('💀 [WATCHDOG] Bot zombie detectado. Reiniciando...');
        process.exit(1);
    }
}, WATCHDOG_INTERVALO);

// ==========================================
// PROCESAR MENSAJE
// ==========================================
async function procesarMensaje(msg) {
    try {
        if (msg.from === 'status@broadcast') return;

        const antiguedadSegundos = Math.floor(Date.now() / 1000) - msg.timestamp;
        if (antiguedadSegundos > 60) return;

        const chatId = msg.fromMe ? msg.to : msg.from;
        const ignoreKey = `${chatId}_${msg.body || ''}`;
        
        if (msg.fromMe) {
            if (botMessagesIgnoreList.has(ignoreKey)) {
                botMessagesIgnoreList.delete(ignoreKey);
                return; 
            } else {
                console.log(` 👤 [HUMANO] Mensaje enviado manualmente.`);
            }
        }

        const idUnico = msg.id._serialized;
        if (mensajesProcesados.has(idUnico)) return;
        mensajesProcesados.add(idUnico);

        ultimaActividad = Date.now();
        
        const tiposPermitidos = [MessageTypes.TEXT, 'chat', MessageTypes.DOCUMENT];
        if (!tiposPermitidos.includes(msg.type)) return;

        const cuerpoMensaje = msg.body ? msg.body.trim().toLowerCase() : '';

        // ==========================================
        // 🚀 INTERCEPCIÓN LOCAL: PANEL DE BIENVENIDA
        // ==========================================
if (cuerpoMensaje === 'bot' || cuerpoMensaje === '/bot') {
            console.log(`\n🤖 [LOCAL] Comando de panel detectado en ${chatId}`);
            
            // El uso de backticks (`) permite que el texto respete los saltos de línea y símbolos.
            const textoPanel = `(Welcome )

֩    ׄ    ✦    ۪    𝐯𝐢𝐜𝐞𝐦𝐢𝐧𝐢𝐬𝐭𝐞𝐫𝐢𝐨 𝐝𝐞 𝐬𝐚𝐥𝐮𝐝    🌘🎗️    ׄ    ׅ

╭┄───── ─────┄
╰⁠►°𝒸𝑜𝓃𝓈𝑜𝓁𝒶 𝒹𝑒 𝒸𝑜𝓂𝒶𝓃𝒹𝑜𝜗𝜚•
En línea: 𝙩𝙚𝙡𝙚𝙘𝙤𝙢𝙪𝙣𝙞𝙘𝙖𝙙𝙤𝙧 
    
          ╭─ִ╌─꯭ׄ──ׂ─۪─ׂ┈──┄┤

 ᥬ🌕• /vincular [codigo]᭄ 

 ᥬ🌕᭄• /archivos [hospital/morgue]

 ᥬ🌕• /descargar "Nombre Exacto"

 ᥬ🌕• /eliminar "Nombre Exacto"

├─┄──꯭ׄ──ׂ┈──ׄ─ׅ╌╯ ׄ

𝓗𝓸𝓼𝓹𝓲𝓽𝓪𝓵 𝓬𝓮𝓷𝓽𝓻𝓪𝓵
          ꨣ┄──᪶─ᷓ─۫┄ ۪ꉹ ֺ 🏥🐍 ۫ ꒱꒱ ┄۫──ᷓ─᪶─┄ ꨣ`;
            
            const rutaImagenLocal = path.join(__dirname, 'logo.png');

            try {
                if (fs.existsSync(rutaImagenLocal)) {
                    const mediaImg = MessageMedia.fromFilePath(rutaImagenLocal);
                    botMessagesIgnoreList.add(`${chatId}_${textoPanel}`);
                    await client.sendMessage(chatId, mediaImg, { caption: textoPanel });
                    console.log(`    ✅ Panel local enviado (con imagen).`);
                } else {
                    console.warn(`    ⚠️ logo.png no encontrado. Enviando solo texto.`);
                    botMessagesIgnoreList.add(`${chatId}_${textoPanel}`);
                    await msg.reply(textoPanel);
                }
            } catch (err) {
                console.error('❌ Error enviando panel local:', err);
            }
            
            // 🛑 CORTAMOS AQUÍ: No enviamos este mensaje a FastAPI
            return; 
        }

        // ==========================================
        // FLUJO NORMAL HACIA FASTAPI
        // ==========================================
        console.log(`\n📨 Mensaje hacia backend de ${chatId} [Tipo: ${msg.type}]`);

        let chatName = "Desconocido";
        try {
            const contact = await msg.getContact();
            chatName = contact.name || contact.pushname || contact.number || "Desconocido";
        } catch (e) {}

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
                const msgEspera = "⏳ El sistema está muy concurrido procesando otros archivos. Por favor, intenta en un minuto.";
                botMessagesIgnoreList.add(`${chatId}_${msgEspera}`);
                await msg.reply(msgEspera);
                return;
            }

            descargasActivas++;
            console.log(`📥 Descargando adjunto PDF...`);

            try {
                const media = await promesaConTimeout(msg.downloadMedia(), 45000);

                if (!media || media.mimetype !== 'application/pdf') {
                    const msgErrorPDF = "⚠️ Por razones de compatibilidad, el sistema médico solo acepta archivos en formato PDF.";
                    botMessagesIgnoreList.add(`${chatId}_${msgErrorPDF}`);
                    await msg.reply(msgErrorPDF);
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
                console.error("❌ Error PDF:", error.message);
                descargasActivas--; 
                return;
            }
            descargasActivas--;
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
        const timeoutId = setTimeout(() => controller.abort(), isDocument ? 45000 : 15000);
        fetchOptions.signal = controller.signal;

        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) return;

        const data = await response.json();

        // 🚀 RESPUESTAS DESDE FASTAPI
        if (data.responder && data.texto) {
            botMessagesIgnoreList.add(`${chatId}_${data.texto}`);
            await msg.reply(data.texto);
            console.log(`    ✅ Respuesta del backend enviada.`);
        }

        if (data.enviar_documento && data.documento_url) {
            try {
                console.log(`📥 Descargando documento remoto de Drive...`);
                const mediaDoc = await promesaConTimeout(MessageMedia.fromUrl(data.documento_url, { unsafeMimeTypes: true }), 60000);
                if (data.documento_nombre) mediaDoc.filename = data.documento_nombre;
                await client.sendMessage(chatId, mediaDoc);
                console.log(`    ✅ Documento PDF transmitido.`);
            } catch (docError) {
                console.error(`❌ Error transmitiendo documento:`, docError.message);
            }
        }

    } catch (error) {
        if (error.name !== 'AbortError') console.error("❌ Error general:", error);
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
    } catch (err) { res.status(500).send('Error QR'); }
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
    } catch (error) { res.status(500).json({ error: error.message }); }
});

client.initialize();
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Puerto ${PORT} activo\n`));