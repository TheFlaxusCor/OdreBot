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
let ultimosMensajeProcesado = {};
const mensajesProcesados = new Set();

const authDir = path.join(__dirname, '.wwebjs_auth');

// Limpieza rápida
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
    } catch (err) {
        // Silenciar
    }
}

limpiarCandados(authDir);

console.log('\n🤖 INICIANDO BOT FINAL PARA RAILWAY\n');

// ==========================================
// CLIENTE CON TIMEOUT EXTENDIDO
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
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-renderer-backgrounding',
            '--disable-backgrounding-occluded-windows',
          
        ],
        protocolTimeout: 120000 // ⭐ 120 SEGUNDOS - CRÍTICO PARA RAILWAY
    }
});



// Limpiar el historial de mensajes procesados cada hora para liberar RAM
setInterval(() => {
    mensajesProcesados.clear();
    console.log('🧹 Limpieza de memoria (Set de mensajes) realizada.');
}, 3600000); // 1 hora

// ==========================================
// PROCESAR MENSAJE
// ==========================================

async function procesarMensaje(msg) {
    try {
        const idUnico = `${msg.from}-${msg.timestamp}`;
        
        if (mensajesProcesados.has(idUnico)) {
            return;
        }
        mensajesProcesados.add(idUnico);

        const esGrupo = msg.from.includes('@g.us');
        const esDelBot = msg.id.fromMe;

        console.log(`\n📨 Mensaje recibido de ${msg.from}`);
        console.log(`   Texto: "${msg.body}"`);


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
        // Log solo errores críticos
        if (!error.message.includes('timeout')) {
            console.error(`❌ Error: ${error.message}`);
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

// ⭐ CORRECCIÓN 1: El evento de mensajes va AFUERA del ready
// De esta forma nos aseguramos que SIEMPRE se registre
client.on('message', async msg => {
    console.log(`[EVENT] Mensaje detectado por evento nativo`);
    await procesarMensaje(msg);
});

// Opcional: Si quieres que también responda a los mensajes que envías TÚ desde tu celular
client.on('message_create', async msg => {
    if(msg.fromMe && msg.body.trim().toLowerCase() === 'hola') {
        console.log(`[EVENT] Mensaje propio detectado`);
        await procesarMensaje(msg);
    }
});

client.on('ready', async () => {
    console.log('⏳ Sincronización inicial completada...');
    
    // ⭐ CORRECCIÓN 2: Eliminamos la carga pesada (getChats y el Polling)
    // Dejamos que WhatsApp envíe los mensajes de forma reactiva (push) en lugar de estar preguntando (pull/polling)
    
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