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
// 🛠️ CLIENTE CON VERSIÓN FIJA Y CONGELADA
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    // Fijamos versión para evitar que los cambios diarios de Meta rompan los eventos
    webVersion: '2.2412.54', 
    webVersionCache: { 
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    },
    puppeteer: {
        headless: true,
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
            '--disable-software-rasterizer',
            '--memory-pressure-off',
            '--js-flags="--max-old-space-size=250"', 
            '--renderer-process-limit=1'
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
        
        // 🔗 CONEXIÓN ASEGURADA: Limpiamos barras y forzamos la ruta del endpoint correcto
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

        // El bot obedece ciegamente lo que diga FastAPI
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
    const puerto = process.env.PORT || 3000;
    console.log(`\n✨ O entra a http://localhost:${puerto}/qr\n`);
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
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

    setInterval(async () => {
        try {
            if (client.pupPage) {
                await client.pupPage.evaluate(() => {
                    window.dispatchEvent(new MouseEvent('mousemove'));
                });
            }
        } catch (error) {}
    }, 60000); 
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
app.get('/qr', async (req, res) => {
    if (!qrData) {
        return res.send(`<h2 style="text-align:center;padding-top:20vh;">✅ Autenticado</h2>`);
    }

    try {
        const qrImg = await qrcode.toDataURL(qrData);
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
            <meta http-equiv="refresh" content="10">
            <style>body{font-family:sans-serif;background:#e5ddd5;
            display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}
            .card{background:white;padding:40px;border-radius:15px;
            box-shadow:0 10px 20px rgba(0,0,0,0.1);text-align:center;}
            img{max-width:300px;margin:20px 0;}</style></head>
            <body><div class="card"><h2>🤖 Bot WhatsApp</h2>
            <img src="${qrImg}"><p>Escanea con WhatsApp</p></div>
            </body></html>`);
    } catch (err) {
        res.status(500).send('Error');
    }
});

app.get('/status', (req, res) => {
    res.json({
        botReady,
        autenticado: client.info ? true : false,
        usuario: client.info?.wid?.user || 'N/A'
    });
});

app.post('/notificar', async (req, res) => {
    if (!botReady) {
        return res.status(503).json({ error: 'Bot no está listo' });
    }

    const { mensaje, to } = req.body;
    
    if (!mensaje || !to) {
        return res.status(400).json({ error: 'Faltan campos (to, mensaje)' });
    }

    try {
        await client.sendMessage(to, mensaje);
        res.json({ status: 'Enviado', target: to });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/test', (req, res) => {
    res.json({ ok: true, botReady });
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