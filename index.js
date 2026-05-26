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
            '--user-data-dir=/app/.wwebjs_auth'
        ],
        protocolTimeout: 120000 // ⭐ 120 SEGUNDOS - CRÍTICO PARA RAILWAY
    }
});

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

        if (esDelBot) {
            console.log(`   ⏭️  (es del bot, ignorar)`);
            return;
        }

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
    console.log('║     🔐 ESCANEA EL CÓDIGO QR 👇         ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
    const puerto = process.env.PORT || 3000;
    console.log(`\n✨ O entra a http://localhost:${puerto}/qr\n`);
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
    qrData = null;
});

client.on('ready', async () => {
    console.log('⏳ Sincronizando...');
    
    try {
        // Obtener chats con timeout
        const chats = await Promise.race([
            client.getChats(),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('getChats timeout')), 30000)
            )
        ]);

        console.log(`✅ Se encontraron ${chats.length} chats\n`);

        botReady = true;

        // ESTRATEGIA HÍBRIDA: Confiar en eventos nativos + polling de respaldo
        
        // Opción 1: Evento message (más confiable en algunos casos)
        client.on('message', async msg => {
            console.log(`[EVENT] Mensaje detectado por evento nativo`);
            await procesarMensaje(msg);
        });

        // Opción 2: Polling optimizado (más lento pero funciona)
        // Solo polling a grupos, cada 3 segundos para evitar timeouts
        chats.filter(c => c.isGroup).forEach(chat => {
            console.log(`🔄 Iniciando polling para grupo: ${chat.name}`);
            
            let ultimoTimestamp = Date.now() / 1000;
            
            setInterval(async () => {
                try {
                    // Fetch con timeout más largo
                    const msgs = await Promise.race([
                        chat.fetchMessages({ limit: 3 }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('fetch timeout')), 25000)
                        )
                    ]);

                    for (const msg of msgs.reverse()) {
                        // Solo procesar mensajes nuevos
                        if (msg.timestamp > ultimoTimestamp) {
                            ultimoTimestamp = msg.timestamp;
                            await procesarMensaje(msg);
                        }
                    }
                } catch (err) {
                    // Solo log de errores no-timeout
                    if (!err.message.includes('timeout')) {
                        console.log(`⚠️  ${chat.name}: ${err.message}`);
                    }
                }
            }, 3000); // Cada 3 segundos, no 1
        });

        console.log('\n╔════════════════════════════════════════╗');
        console.log('║   ✅ ¡BOT EN LÍNEA Y LISTO!            ║');
        console.log('║   Esperando mensajes con "hola"         ║');
        console.log('╚════════════════════════════════════════╝\n');

    } catch (error) {
        console.error(`❌ Error en inicialización: ${error.message}`);
        botReady = true; // Intentar de todas formas
    }
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