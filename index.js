const { Client, LocalAuth, MessageTypes } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// LOGS EN MEMORIA (para ver desde API)
let logsEnMemoria = [];
function logear(msg) {
    const timestamp = new Date().toLocaleTimeString();
    const mensaje = `[${timestamp}] ${msg}`;
    console.log(mensaje);
    logsEnMemoria.push(mensaje);
    if (logsEnMemoria.length > 200) logsEnMemoria.shift(); // Mantener últimos 200
}

logear('═════════════════════════════════════════');
logear('🤖 INICIANDO BOT EN RAILWAY');
logear('═════════════════════════════════════════');

let qrData = null;
let botReady = false;
let chatsCargados = [];
const mensajesProcesados = new Set();

const authDir = path.join(__dirname, '.wwebjs_auth');

function limpiarCandados(directorio) {
    if (!fs.existsSync(directorio)) return;
    try {
        const archivos = fs.readdirSync(directorio);
        archivos.forEach(archivo => {
            const rutaCompleta = path.join(directorio, archivo);
            const stat = fs.lstatSync(rutaCompleta);
            if (stat.isDirectory()) {
                limpiarCandados(rutaCompleta);
            } else {
                if (archivo.includes('SingletonLock') || archivo.includes('SingletonCookie')) {
                    fs.unlinkSync(rutaCompleta);
                    logear(`🧹 Candado eliminado: ${archivo}`);
                }
            }
        });
    } catch (err) {
        logear(`⚠️ Error limpiando candados: ${err.message}`);
    }
}

logear('🔍 Limpiando sesión anterior...');
limpiarCandados(authDir);

// ==========================================
// CREAR CLIENTE CON LOGGING AGRESIVO
// ==========================================

logear('📱 Creando cliente WhatsApp...');

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
            '--disable-single-click-autofill',
            '--disable-extensions',
            '--user-data-dir=/app/.wwebjs_auth',
            '--disable-background-timer-throttling', // IMPORTANTE: Para Railway
            '--disable-renderer-backgrounding', // IMPORTANTE: Para Railway
            '--disable-backgrounding-occluded-windows' // IMPORTANTE: Para Railway
        ]
    }
});

// ==========================================
// EVENTOS CON LOGGING ULTRA-DETALLADO
// ==========================================

client.on('qr', qr => {
    qrData = qr;
    logear('📲 QR GENERADO - Escanea ahora');
    console.clear();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     🔐 ESCANEA EL CÓDIGO QR 👇         ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
    const puerto = process.env.PORT || 3000;
    console.log(`\n✨ O entra a http://localhost:${puerto}/qr\n`);
});

client.on('authenticated', () => {
    logear('✅ AUTENTICACIÓN EXITOSA - Sesión guardada');
    qrData = null;
});

client.on('ready', async () => {
    logear('⏳ Estado READY detectado - Sincronizando chats...');
    
    try {
        // PASO CRÍTICO: Obtener todos los chats
        logear('🔄 Ejecutando client.getChats()...');
        const chats = await client.getChats();
        
        logear(`✅ Se obtuvieron ${chats.length} chats`);
        chatsCargados = chats;

        // Detallar cada chat
        chats.forEach((chat, index) => {
            const tipo = chat.isGroup ? '👥 GRUPO' : '👤 PRIVADO';
            logear(`  [${index + 1}] ${tipo} - ${chat.name} (${chat.id._serialized})`);
        });

        // INICIAR POLLING
        if (chats.length > 0) {
            logear('🔄 INICIANDO POLLING en todos los chats...');
            
            chats.forEach(async (chat) => {
                try {
                    logear(`  ▶️  Polling iniciado para: ${chat.name}`);
                    
                    // Polling agresivo cada 1 segundo
                    setInterval(async () => {
                        try {
                            const msgs = await chat.fetchMessages({ limit: 5 });
                            
                            for (const msg of msgs.reverse()) {
                                await procesarMensaje(msg, chat);
                            }
                        } catch (err) {
                            // Silenciar errores de timeout
                            if (!err.message.includes('timeout')) {
                                logear(`⚠️  Error fetching en ${chat.name}: ${err.message}`);
                            }
                        }
                    }, 1000);
                    
                } catch (err) {
                    logear(`❌ Error iniciando polling para ${chat.name}: ${err.message}`);
                }
            });

            botReady = true;
            logear('╔════════════════════════════════════════╗');
            logear('║   ✅ ¡BOT EN LÍNEA Y LISTO!            ║');
            logear('║   Polling iniciado en todos los chats   ║');
            logear('╚════════════════════════════════════════╝');
            
        } else {
            logear('⚠️  NO SE ENCONTRARON CHATS');
            logear('💡 Posible causa: El bot no sincronizó los chats correctamente');
            logear('💡 Solución: Abre WhatsApp en el teléfono que escaneó QR');
            botReady = true;
        }

    } catch (error) {
        logear(`❌ ERROR CRÍTICO en ready: ${error.message}`);
        logear(`Stack: ${error.stack}`);
    }
});

client.on('auth_failure', (msg) => {
    logear(`❌ ❌ FALLO DE AUTENTICACIÓN: ${msg}`);
});

client.on('disconnected', (reason) => {
    botReady = false;
    logear(`⚠️  BOT DESCONECTADO: ${reason}`);
});

// FALLBACK: evento 'message' también
client.on('message', async msg => {
    logear(`📡 Evento 'message' detectado (FALLBACK) - ${msg.body}`);
    await procesarMensaje(msg, null);
});

// ==========================================
// FUNCIÓN PROCESAR MENSAJE
// ==========================================

async function procesarMensaje(msg, chatObj) {
    try {
        const idUnico = `${msg.from}-${msg.timestamp}`;
        
        if (mensajesProcesados.has(idUnico)) {
            return;
        }
        mensajesProcesados.add(idUnico);

        const esGrupo = msg.from.includes('@g.us') ? '👥' : '👤';
       

        logear(`\n${'═'.repeat(50)}`);
        logear(`📨 ${esGrupo} MENSAJE RECIBIDO`);
        logear(`  De: ${msg.from}`);
        logear(`  Texto: "${msg.body}"`);
        logear(`  ¿Es del bot?: ${esDelBot ? 'SÍ (ignorar)' : 'NO'}`);

        if (esDelBot) {
            logear(`  ⏭️  [Ignorado - es mensaje del bot]`);
            return;
        }

        // Procesar
        const limpio = msg.body.trim().toLowerCase();
        logear(`  Limpio: "${limpio}"`);

        if (limpio === 'hola') {
            logear(`  ✅✅✅ ¡¡¡COMANDO DETECTADO!!!`);
            
            const chat = chatObj || (await msg.getChat());
            const idChat = chat.id._serialized || chat.id;
            
            logear(`  Chat: ${chat.name}`);
            logear(`  ID: ${idChat}`);
            
            const respuesta = `🤖 *Info*\nNombre: ${chat.name}\nID: *${idChat}*`;
            
            logear(`  📤 ENVIANDO RESPUESTA...`);
            await msg.reply(respuesta);
            logear(`  ✉️  ✅ RESPUESTA ENVIADA EXITOSAMENTE`);
        } else {
            logear(`  ❌ No es 'hola' (es: "${limpio}")`);
        }

        logear(`${'═'.repeat(50)}\n`);

    } catch (error) {
        logear(`❌ ERROR procesando: ${error.message}`);
    }
}

// ==========================================
// ENDPOINTS
// ==========================================

app.get('/qr', async (req, res) => {
    if (!qrData) {
        return res.send(`<h2 style="text-align:center;padding-top:20vh;">
            ✅ Bot autenticado ${botReady ? '✅ LISTO' : '⏳ Iniciando...'}
        </h2>`);
    }

    try {
        const qrImg = await qrcode.toDataURL(qrData);
        res.send(`<!DOCTYPE html>
            <html><head><meta charset="UTF-8"><title>Bot QR</title>
            <meta http-equiv="refresh" content="10">
            <style>body{font-family:sans-serif;background:#e5ddd5;display:flex;
            justify-content:center;align-items:center;height:100vh;margin:0;}
            .card{background:white;padding:40px;border-radius:15px;
            box-shadow:0 10px 20px rgba(0,0,0,0.1);text-align:center;}
            img{max-width:300px;margin:20px 0;}</style></head>
            <body><div class="card"><h2>🤖 Bot WhatsApp</h2>
            <img src="${qrImg}"><p>Escanea con WhatsApp</p></div>
            </body></html>`);
    } catch (err) {
        res.status(500).send('Error QR');
    }
});

app.get('/status', (req, res) => {
    res.json({
        botReady,
        autenticado: client.info ? true : false,
        usuario: client.info?.wid?.user || 'N/A',
        chatsDetectados: chatsCargados.length,
        pollingActivo: chatsCargados.length > 0
    });
});

app.get('/chats', (req, res) => {
    res.json({
        total: chatsCargados.length,
        chats: chatsCargados.map(c => ({
            nombre: c.name,
            id: c.id._serialized,
            tipo: c.isGroup ? 'GRUPO' : 'PRIVADO'
        }))
    });
});

// ENDPOINT MÁS IMPORTANTE: Ver logs en vivo
app.get('/logs', (req, res) => {
    res.json({
        logsRecientes: logsEnMemoria,
        totalLogs: logsEnMemoria.length
    });
});

// Ver último log en HTML (útil para debugging en navegador)
app.get('/logs-web', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Logs Bot</title>
        <style>
            body { font-family: monospace; background: #1e1e1e; color: #00ff00; 
                   padding: 20px; margin: 0; }
            pre { white-space: pre-wrap; word-wrap: break-word; }
            .refresh { position: fixed; top: 10px; right: 10px; }
            button { padding: 10px 20px; cursor: pointer; }
        </style>
        <script>
            function recargar() {
                fetch('/logs')
                    .then(r => r.json())
                    .then(d => {
                        document.getElementById('logs').textContent = 
                            d.logsRecientes.join('\\n');
                        document.getElementById('contador').textContent = 
                            d.totalLogs + ' logs';
                    });
            }
            setInterval(recargar, 1000);
            recargar();
        </script>
    </head>
    <body>
        <div class="refresh">
            <button onclick="recargar()">🔄 Recargar</button>
            <p id="contador">0 logs</p>
        </div>
        <h2>📋 Logs en Vivo</h2>
        <pre id="logs">Cargando...</pre>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/test', (req, res) => {
    res.json({ ok: true, botReady });
});

// ==========================================
// INICIAR
// ==========================================

logear('🔌 Inicializando cliente...');
client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    logear(`\n🚀 SERVIDOR ESCUCHANDO EN PUERTO ${PORT}`);
    logear(`📋 Ver logs: http://localhost:${PORT}/logs-web`);
    logear(`📊 API Status: http://localhost:${PORT}/status`);
    logear(`🗂️  Chats: http://localhost:${PORT}/chats\n`);
});