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

// ==========================================
// 🛡️ ESCUDO INTELIGENTE (FAIL-FAST)
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    const errorMsg = String(reason).toLowerCase();
    
    if (errorMsg.includes('target closed') || 
        errorMsg.includes('session closed') || 
        errorMsg.includes('execution context was destroyed')) {
        console.error('\n💀 [CRÍTICO] Chromium colapsó por falta de memoria o inactividad.');
        console.error('🔄 Forzando reinicio automático del contenedor en Railway...\n');
        process.exit(1); 
    } else {
        console.error('⚠️ Promesa rechazada (Ignorada):', reason);
    }
});

// Limpieza rápida de candados corruptos
function limpiarCandados(dir) {
    if (!fs.existsSync(dir)) return;
    try {
        const archivos = fs.readdirSync(dir);
        archivos.forEach(archivo => {
            const ruta = path.join(dir, archivo);
            const stat = fs.lstatSync(ruta);
            if (stat.isDirectory()) {
                limpiarCandados(ruta);
            } else {
                if (archivo.includes('Lock') || archivo.includes('Cookie')) {
                    fs.unlinkSync(ruta);
                }
            }
        });
    } catch (err) {}
}

limpiarCandados(authDir);

console.log('\n🤖 INICIANDO BOT OBRERO PARA RAILWAY\n');

// ==========================================
// 🛠️ CLIENTE OPTIMIZADO PARA ESTABILIDAD
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    // Dejamos que la librería gestione la versión más reciente compatible automáticamente
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
            // 🕶️ User-Agent moderno y real para evitar bloqueos/peticiones de actualización
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ],
        protocolTimeout: 300000 
    }
});

setInterval(() => {
    mensajesProcesados.clear();
    console.log('🧹 Limpieza de memoria (Set de mensajes) realizada.');
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

        console.log(`\n📨 Mensaje recibido de ${msg.from}`);

        if (msg.type !== MessageTypes.TEXT && msg.type !== 'chat') {
            console.log(`    ⏭️  (Ignorado: no es texto)`);
            return;
        }

        const chat = await msg.getChat();
        
        console.log(`    🧠 Consultando al cerebro en FastAPI...`);
        
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

        if (!response.ok) {
            console.error(`    ❌ Error HTTP del backend: ${response.status}`);
            return;
        }

        const data = await response.json();

        if (data.responder && data.texto) {
            console.log(`    📤 Enviando respuesta dictada por el backend...`);
            await msg.reply(data.texto);
            console.log(`    ✅ Respuesta enviada\n`);
        } else {
            console.log(`    🤫 El backend ordenó ignorar este mensaje.\n`);
        }

    } catch (error) {
        if (!error.message.includes('timeout')) {
            console.error(`❌ Error de comunicación con FastAPI: ${error.message}`);
        }
    }
}

// ==========================================
// EVENTOS
// ==========================================
client.on('qr', qr => {
    qrData = qr;
    console.clear();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║    🔐 ESCANEA EL CÓDIGO QR 👇          ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa (Sesión reconocida)');
    qrData = null;
});

client.on('message', async msg => {
    await procesarMensaje(msg);
});

client.on('message_create', async msg => {
    if(msg.fromMe) {
        await procesarMensaje(msg);
    }
});

client.on('ready', async () => {
    botReady = true;
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║    ✅ ¡BOT OBRERO EN LÍNEA!            ║');
    console.log('║    Esperando órdenes del backend      ║');
    console.log('╚════════════════════════════════════════╝\n');
});

client.on('auth_failure', (msg) => {
    console.error(`❌ Fallo de autenticación: ${msg}`);
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log(`\n⚠️  Desconectado: ${reason}`);
    console.log('🔄 Reiniciando contenedor para re-vincular sesión...');
    process.exit(1);
});

// ==========================================
// ENDPOINTS
// ==========================================
app.get('/screenshot', async (req, res) => {
    if (!client.pupPage || client.pupPage.isClosed()) {
        return res.status(400).send("<h3>Navegador no inicializado o página colapsada</h3>");
    }
    try {
        const screenshot = await client.pupPage.screenshot({ encoding: 'base64' });
        res.send(`
            <!DOCTYPE html>
            <html>
            <body style="background:#222; color:white; font-family:sans-serif; text-align:center;">
                <h2>Vista interna de Chromium</h2>
                <img src="data:image/png;base64,${screenshot}" style="width:80%; border:3px solid #444;"/>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send("Error capturando pantalla: " + err.message);
    }
});

app.get('/qr', async (req, res) => {
    if (!qrData) {
        return res.send(`<h2 style="text-align:center;padding-top:20vh;">✅ Autenticado</h2>`);
    }
    try {
        const qrImg = await qrcode.toDataURL(qrData);
        res.send(`<!DOCTYPE html><html><body><div style="text-align:center;"><img src="${qrImg}"><p>Escanea</p></div></body></html>`);
    } catch (err) {
        res.status(500).send('Error');
    }
});

app.get('/status', (req, res) => {
    res.json({ botReady, autenticado: client.info ? true : false });
});

app.post('/notificar', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'Bot no listo' });
    const { mensaje, to } = req.body;
    try {
        await client.sendMessage(to, mensaje);
        res.json({ status: 'Enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// INICIAR
// ==========================================
console.log('📱 Inicializando cliente...\n');
client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en puerto ${PORT}\n`);
});