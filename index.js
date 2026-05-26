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
// 🛡️ ESCUDO ANTI-CRASH PARA RAILWAY
// Evita que el contenedor muera si Chromium se desconecta un microsegundo
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Promesa rechazada (Ignorada para mantener el bot vivo):', reason);
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

console.log('\n🤖 INICIANDO BOT FINAL PARA RAILWAY\n');

// ==========================================
// CLIENTE CON TIMEOUT Y SIN CACHÉ (EVITA SORDERA)
// ==========================================

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: authDir }),
    // ⭐ CORRECCIÓN 1: Esto evita que WhatsApp recargue la página y el bot se quede estático
    webVersionCache: { 
        type: 'none' 
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
            '--memory-pressure-off'
        ],
        protocolTimeout: 300000 // 5 MINUTOS para Railway
    }
});

// Limpiar el historial de mensajes procesados cada hora para liberar RAM
setInterval(() => {
    mensajesProcesados.clear();
    console.log('🧹 Limpieza de memoria (Set de mensajes) realizada.');
}, 3600000); // 1 hora

// ==========================================
// PROCESAR MENSAJE (CENTRAL)
// ==========================================

async function procesarMensaje(msg) {
    try {
        // ⭐ Ignorar estados de WhatsApp para no saturar los logs
        if (msg.from === 'status@broadcast') return;

        // ⭐ CORRECCIÓN 2: Usar el ID serializado real de WhatsApp. 
        // Esto garantiza que NUNCA se confunda un mensaje con otro en los grupos.
        const idUnico = msg.id._serialized;
        
        if (mensajesProcesados.has(idUnico)) {
            return; // Ya lo procesamos, ignorar
        }
        mensajesProcesados.add(idUnico);

        console.log(`\n📨 Mensaje recibido de ${msg.from}`);
        console.log(`   Texto: "${msg.body}"`);

        // Validar si es texto
        if (msg.type !== MessageTypes.TEXT && msg.type !== 'chat') {
            console.log(`   ⏭️  (no es texto)`);
            return;
        }

        const limpio = msg.body.trim().toLowerCase();

        if (limpio === 'hola') {
            console.log(`   ✅ COMANDO DETECTADO`);
            
            const chat = await msg.getChat();
            const idChat = chat.id._serialized || chat.id;
            
            console.log(`   Chat: ${chat.name}`);
            console.log(`   📤 Enviando respuesta...`);
            
            await msg.reply(
                `🤖 *Info*\n` +
                `Nombre: ${chat.name}\n` +
                `ID: *${idChat}*`
            );
            
            console.log(`   ✅ Respuesta enviada\n`);
        }

    } catch (error) {
        if (!error.message.includes('timeout')) {
            console.error(`❌ Error al procesar: ${error.message}`);
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
    console.log('║    🔐 ESCANEA EL CÓDIGO QR 👇        ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
    const puerto = process.env.PORT || 3000;
    console.log(`\n✨ O entra a http://localhost:${puerto}/qr\n`);
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
    qrData = null;
});

// Detecta los mensajes que te envían TERCEROS y en GRUPOS
client.on('message', async msg => {
    await procesarMensaje(msg);
});

// ⭐ CORRECCIÓN 3: Detecta los mensajes que envías TÚ MISMO (sin filtros extraños)
client.on('message_create', async msg => {
    if(msg.fromMe) {
        await procesarMensaje(msg);
    }
});

client.on('ready', async () => {
    botReady = true;
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ ¡BOT EN LÍNEA Y LISTO!            ║');
    console.log('║   Esperando mensajes de forma nativa   ║');
    console.log('╚════════════════════════════════════════╝\n');
});

client.on('auth_failure', (msg) => {
    console.error(`❌ Fallo de autenticación: ${msg}`);
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log(`⚠️  Desconectado: ${reason}`);
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

    const { mensaje, grupoId } = req.body;
    
    if (!mensaje || !grupoId) {
        return res.status(400).json({ error: 'Faltan campos' });
    }

    try {
        await client.sendMessage(grupoId, mensaje);
        res.json({ status: 'Enviado', target: grupoId });
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