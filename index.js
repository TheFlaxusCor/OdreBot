const { Client, LocalAuth, MessageTypes } = require('whatsapp-web.js');
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
        } catch (err) {
            console.error('⚠️  No se pudo purgar la caché.');
        }
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
// 🛠️ CLIENTE OPTIMIZADO PARA BAJA RAM
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: {
        headless: true,
        // ✅ PATH CORREGIDO: Chromium snap real
        executablePath: '/snap/chromium/current/usr/lib/chromium-browser/chrome',
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
const WATCHDOG_INTERVALO = 5 * 60 * 1000;   // Revisar cada 5 minutos
const WATCHDOG_TIMEOUT   = 30 * 60 * 1000;  // 30 min sin actividad → reiniciar

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
// PROCESAR MENSAJE (VERSIÓN HERMES 2.0)
// ==========================================
async function procesarMensaje(msg) {
    try {
        if (msg.from === 'status@broadcast') return;

        const idUnico = msg.id._serialized;
        if (mensajesProcesados.has(idUnico)) return;
        mensajesProcesados.add(idUnico);

        ultimaActividad = Date.now();
        console.log(`\n📨 Mensaje de ${msg.from} [Tipo: ${msg.type}]`);

        // 🛡️ 1. EL NUEVO FILTRO: Ahora aceptamos DOCUMENTOS
        const tiposPermitidos = [MessageTypes.TEXT, 'chat', MessageTypes.DOCUMENT];
        if (!tiposPermitidos.includes(msg.type)) return;

        const chat = await msg.getChat();
        const baseUrl = process.env.BACKEND_URL || 'https://backend-odrekao.fastapicloud.dev';
        const apiKey = process.env.BOT_API_KEY || 'odrekao_super_secreto';
        
        let targetUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/webhook`;
        let fetchOptions = {
            method: 'POST',
            headers: { 'x-api-key': apiKey }
            // body se asignará más abajo
        };

        // 📦 2. MANEJO DE ARCHIVOS ADJUNTOS
        let isDocument = msg.hasMedia && msg.type === MessageTypes.DOCUMENT;
        
        if (isDocument) {
            // Semáforo de RAM: Prevenir OOM (Out Of Memory)
            if (descargasActivas >= MAX_DESCARGAS) {
                await msg.reply("⏳ El sistema está muy concurrido procesando otros archivos. Por favor, intenta enviar tu documento en un minuto.");
                return;
            }

            descargasActivas++;
            console.log(`📥 Descargando adjunto... (Descargas activas: ${descargasActivas})`);

            try {
                const media = await msg.downloadMedia();

                // Validación estricta: Solo PDFs
                if (!media || media.mimetype !== 'application/pdf') {
                    await msg.reply("⚠️ Por razones de compatibilidad, el sistema médico solo acepta archivos en formato PDF.");
                    descargasActivas--;
                    return;
                }

                // Construir FormData nativo (Requiere Node.js 18+)
                const formData = new FormData();
                formData.append('from_id', chat.id._serialized || chat.id);
                formData.append('chat_name', chat.name || "Desconocido");
                formData.append('body', msg.body || ''); // Por si enviaron texto junto al PDF
                formData.append('timestamp', msg.timestamp);

                // Convertir Base64 a Blob para enviarlo como archivo real
                const buffer = Buffer.from(media.data, 'base64');
                const blob = new Blob([buffer], { type: media.mimetype });
                formData.append('file', blob, media.filename || 'documento.pdf');

                fetchOptions.body = formData;
                // No configuramos 'Content-Type', fetch lo hace automáticamente para FormData
                
                // Cambiamos la ruta destino
                targetUrl = `${baseUrl.replace(/\/$/, '')}/upload/pdf-whatsapp`; 

            } catch (error) {
                console.error("❌ Error procesando el PDF en memoria:", error);
                await msg.reply("❌ Ocurrió un error al procesar tu archivo. Inténtalo de nuevo.");
                descargasActivas--;
                return;
            }
            
            // Liberamos el slot de descarga
            descargasActivas--;
            console.log(`✅ Archivo preparado. Enviando a FastAPI...`);

        } else {
            // 📝 3. MANEJO DE TEXTO NORMAL
            fetchOptions.headers['Content-Type'] = 'application/json';
            fetchOptions.body = JSON.stringify({
                from_id: chat.id._serialized || chat.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                chat_name: chat.name || "Desconocido"
            });
        }

        // ⏱️ 4. TIMEOUT INTELIGENTE
        // Le damos 45 segundos si es archivo, 15 segundos si es texto normal
        const controller = new AbortController();
        const timeoutDuration = isDocument ? 45000 : 15000; 
        const timeoutId = setTimeout(() => controller.abort(), timeoutDuration);
        fetchOptions.signal = controller.signal;

        // 🚀 5. DISPARO AL BACKEND
        const response = await fetch(targetUrl, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
            console.error(`⚠️ Error del backend: ${response.status} ${response.statusText}`);
            return;
        }

        const data = await response.json();

        // Respuesta opcional desde FastAPI
        if (data.responder && data.texto) {
            await msg.reply(data.texto);
            console.log(`    ✅ Respuesta enviada al usuario.`);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('⏱️ Timeout: El backend tardó demasiado en responder.');
        } else {
            console.error(`❌ Error en procesarMensaje: ${error.message}`);
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

client.on('message',        async msg => { await procesarMensaje(msg); });
client.on('message_create', async msg => { if (msg.fromMe) await procesarMensaje(msg); });

client.on('ready', () => {
    botReady = true;
    ultimaActividad = Date.now();
    console.log('\n✅ ¡BOT EN LÍNEA!\n');
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