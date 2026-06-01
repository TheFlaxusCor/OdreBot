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
const mensajesProcesados = new Set();

const authDir = path.join(__dirname, '.wwebjs_auth');
const cacheDir = path.join(__dirname, '.wwebjs_cache'); // 🚨 Directorio del devorador de RAM

// ==========================================
// 🛡️ ESCUDO INTELIGENTE (FAIL-FAST)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = String(reason).toLowerCase();
    
    if (errorMsg.includes('target closed') || 
        errorMsg.includes('session closed') || 
        errorMsg.includes('execution context was destroyed')) {
        console.error('\n💀 [CRÍTICO] Chromium colapsó. El OOM Killer o la inactividad lo mataron.');
        console.error('🔄 PM2 se encargará del reinicio automático...\n');
        process.exit(1); 
    } else {
        console.error('⚠️ Promesa rechazada (Ignorada):', reason);
    }
});

// ==========================================
// 🧹 LIMPIEZA EXTREMA (ANTES DE INICIAR)
// ==========================================
function aniquilarCache() {
    // 1. Borrar caché multimedia
    if (fs.existsSync(cacheDir)) {
        try {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            console.log('🗑️  Caché de Chromium purgada con éxito.');
        } catch (err) {
            console.error('⚠️  No se pudo purgar la caché por completo.');
        }
    }

    // 2. Limpiar candados corruptos
    if (!fs.existsSync(authDir)) return;
    try {
        const archivos = fs.readdirSync(authDir);
        archivos.forEach(archivo => {
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

console.log('\n🤖 INICIANDO BOT OBRERO EN MODO SUPERVIVENCIA\n');

// ==========================================
// 🛠️ CLIENTE OPTIMIZADO PARA BAJA RAM
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote',
            '--no-first-run',
            '--disable-software-rasterizer',
            '--disable-gl-drawing-for-tests',
            // 🚨 Banderas extremas para ahorrar RAM:
            '--disk-cache-size=52428800', // Limita la caché a 50MB máximo
            '--disable-extensions', // Sin extensiones
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-client-side-phishing-detection',
            '--disable-default-apps',
            '--disable-sync',
            '--metrics-recording-only',
            '--mute-audio',
            '--safebrowsing-disable-auto-update',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        protocolTimeout: 300000 
    }
});

// Limpieza en caliente del Set de mensajes para que Node no consuma RAM poco a poco
setInterval(() => {
    mensajesProcesados.clear();
    console.log('🧹 Limpieza de Set de mensajes realizada en memoria.');
}, 3600000); 

// ==========================================
// PROCESAR MENSAJE (EL MENSAJERO)
// ==========================================
async function procesarMensaje(msg) {
    try {
        if (msg.from === 'status@broadcast') return;

        const idUnico = msg.id._serialized;
        
        if (mensajesProcesados.has(idUnico)) {
            return; 
        }
        mensajesProcesados.add(idUnico);

        console.log(`\n📨 Mensaje de ${msg.from}`);

        if (msg.type !== MessageTypes.TEXT && msg.type !== 'chat') return;

        const chat = await msg.getChat();
        
        const baseUrl = process.env.BACKEND_URL || 'https://backend-odrekao.fastapicloud.dev';
        const backendUrl = `${baseUrl.replace(/\/$/, '')}/api/bot/webhook`;
        const apiKey = process.env.BOT_API_KEY || 'odrekao_super_secreto';

        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-api-key': apiKey
            },
            body: JSON.stringify({
                from_id: chat.id._serialized || chat.id,
                body: msg.body,
                type: msg.type,
                timestamp: msg.timestamp,
                chat_name: chat.name || "Desconocido"
            })
        });

        if (!response.ok) return;

        const data = await response.json();

        if (data.responder && data.texto) {
            await msg.reply(data.texto);
            console.log(`    ✅ Respuesta de FastAPI enviada.`);
        }

    } catch (error) {
        if (!error.message.includes('timeout')) {
            console.error(`❌ Error HTTP: ${error.message}`);
        }
    }
}

// ==========================================
// EVENTOS
// ==========================================
client.on('qr', qr => {
    qrData = qr;
    console.clear();
    console.log('\n🔐 ESCANEA EL CÓDIGO QR 👇\n');
    qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
    qrData = null;
});

client.on('message', async msg => { await procesarMensaje(msg); });
client.on('message_create', async msg => { if(msg.fromMe) await procesarMensaje(msg); });

client.on('ready', () => {
    botReady = true;
    console.log('\n✅ ¡BOT OBRERO EN LÍNEA Y OPTIMIZADO!\n');
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log(`\n⚠️  Desconectado: ${reason}`);
    process.exit(1); // Dejamos que PM2 lo reinicie
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
        res.status(500).send('Error');
    }
});

app.get('/status', (req, res) => res.json({ botReady, autenticado: client.info ? true : false }));

app.post('/notificar', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'Bot no listo' });
    try {
        await client.sendMessage(req.body.to, req.body.mensaje);
        res.json({ status: 'Enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

console.log('📱 Inicializando cliente...\n');
client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Escuchando en puerto ${PORT}\n`));