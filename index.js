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

// Sistema de caché para rastrear mensajes procesados
const mensajesProcesados = new Set();
const intervalosPolling = new Map();

const authDir = path.join(__dirname, '.wwebjs_auth');

function limpiarCandadosRecursivo(directorio) {
    if (!fs.existsSync(directorio)) return;
    const archivos = fs.readdirSync(directorio);
    archivos.forEach(archivo => {
        const rutaCompleta = path.join(directorio, archivo);
        try {
            const stat = fs.lstatSync(rutaCompleta);
            if (stat.isDirectory()) {
                limpiarCandadosRecursivo(rutaCompleta);
            } else {
                if (archivo.includes('SingletonLock') || archivo.includes('SingletonCookie')) {
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🧹 Candado eliminado: ${rutaCompleta}`);
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`⚠️ Error: ${err.message}`);
            }
        }
    });
}

console.log('🔍 Limpiando...');
limpiarCandadosRecursivo(authDir);

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
            '--user-data-dir=/app/.wwebjs_auth'
        ]
    }
});

// ==========================================
// FUNCIÓN PRINCIPAL: Procesar un mensaje
// ==========================================
async function procesarMensaje(msg) {
    try {
        const idUnico = `${msg.id.fromMe ? 'SENT' : msg.from}-${msg.timestamp}`;
        
        // Evitar procesar el mismo mensaje dos veces
        if (mensajesProcesados.has(idUnico)) {
            return;
        }
        mensajesProcesados.add(idUnico);

        const tipoMensaje = msg.type || 'desconocido';
        const esGrupo = msg.from.includes('@g.us') ? '👥 GRUPO' : '👤 PRIVADO';
        const esDelBot = msg.id.fromMe;

        console.log(`\n${'═'.repeat(50)}`);
        console.log(`📨 MENSAJE RECIBIDO`);
        console.log(`${'═'.repeat(50)}`);
        console.log(`📱 Tipo: ${esGrupo}`);
        console.log(`👤 De: ${msg.from}`);
        console.log(`🤖 ¿Es mío?: ${esDelBot ? 'SÍ' : 'NO'}`);
        console.log(`📝 Texto: "${msg.body}"`);
        console.log(`⏰ Timestamp: ${new Date(msg.timestamp * 1000).toLocaleString()}`);

        // IMPORTANTE: Ignorar los mensajes que el bot ENVÍA
        if (esDelBot) {
            console.log(`⏭️  Ignorando (es mensaje del bot)`);
            console.log(`${'═'.repeat(50)}\n`);
            return;
        }

        // Ignorar mensajes multimedia
        if (msg.type !== MessageTypes.TEXT && msg.type !== 'chat') {
            console.log(`⏭️  Ignorando (tipo: ${tipoMensaje})`);
            console.log(`${'═'.repeat(50)}\n`);
            return;
        }

        // Procesar el mensaje
        const mensajeLimpio = msg.body.trim().toLowerCase();
        console.log(`🔤 Texto limpio: "${mensajeLimpio}"`);

        if (mensajeLimpio === 'hola') {
            console.log(`✅ ¡¡COMANDO DETECTADO!!: "hola"`);
            
            const chat = await msg.getChat();
            const idChat = chat.id._serialized || chat.id;
            
            console.log(`📍 Chat: ${chat.name}`);
            console.log(`🔑 ID: ${idChat}`);
            console.log(`👥 Es grupo: ${chat.isGroup}`);

            const respuesta = 
                `🤖 *Info del Chat/Grupo*\n` +
                `Nombre: ${chat.name}\n` +
                `ID: *${idChat}*\n` +
                `Tipo: ${chat.isGroup ? '👥 Grupo' : '👤 Privado'}`;

            await msg.reply(respuesta);
            console.log(`✉️  ✅ RESPUESTA ENVIADA`);
        } else {
            console.log(`❌ No coincide (esperaba "hola")`);
        }

        console.log(`${'═'.repeat(50)}\n`);

    } catch (error) {
        console.error(`\n❌ ERROR PROCESANDO:`, error.message);
    }
}

// ==========================================
// SISTEMA DE POLLING PARA GRUPOS
// ==========================================
async function iniciarPollingDeGrupos() {
    if (!botReady) return;

    try {
        const chats = await client.getChats();
        
        chats.forEach(chat => {
            // Solo hacer polling a grupos
            if (!chat.isGroup) return;

            const chatId = chat.id._serialized;

            // Si ya tiene un intervalo, no crear otro
            if (intervalosPolling.has(chatId)) return;

            // Crear intervalo de polling para este grupo
            const intervalo = setInterval(async () => {
                try {
                    // Obtener los últimos 10 mensajes del grupo
                    const mensajes = await chat.fetchMessages({ limit: 10 });
                    
                    // Procesar cada uno
                    for (const msg of mensajes.reverse()) {
                        await procesarMensaje(msg);
                    }
                } catch (err) {
                    // Silencioso - solo logging si hay error crítico
                    if (err.message.includes('timeout')) {
                        console.log(`⚠️  Timeout en polling de ${chat.name}`);
                    }
                }
            }, 2000); // Polling cada 2 segundos

            intervalosPolling.set(chatId, intervalo);
            console.log(`🔄 Polling iniciado para grupo: ${chat.name}`);
        });

    } catch (error) {
        console.error(`❌ Error en polling:`, error.message);
    }
}

// ==========================================
// EVENTOS DEL CLIENTE
// ==========================================

client.on('qr', qr => {
    qrData = qr;
    console.clear();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     🔐 ESCANEA EL CÓDIGO QR 👇         ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
    const puertoActual = process.env.PORT || 3000;
    console.log(`\n✨ O entra a http://localhost:${puertoActual}/qr`);
});

client.on('authenticated', () => {
    console.log('\n✅ Autenticación exitosa');
    qrData = null;
});

client.on('ready', () => {
    botReady = true;
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ ¡BOT EN LÍNEA Y LISTO!            ║');
    console.log('║   Usando POLLING para grupos            ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    // Iniciar polling
    iniciarPollingDeGrupos();
    
    // Re-hacer polling cada 10 segundos para detectar nuevos grupos
    setInterval(iniciarPollingDeGrupos, 10000);
});

// FALLBACK: Usar evento 'message' también (por si funciona en algún caso)
client.on('message', async msg => {
    console.log(`📡 Evento 'message' disparado (FALLBACK)`);
    await procesarMensaje(msg);
});

// Escuchar cambios en chats
client.on('chat_archive', async (chat) => {
    console.log(`💬 Chat actualizado: ${chat.name}`);
    if (chat.isGroup && !intervalosPolling.has(chat.id._serialized)) {
        await iniciarPollingDeGrupos();
    }
});

client.on('auth_failure', (msg) => {
    console.error(`\n❌ ERROR DE AUTENTICACIÓN:`, msg);
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log(`\n⚠️  Bot desconectado: ${reason}`);
    console.log(`🔄 Intentando reconectar...`);
});

// ==========================================
// ENDPOINTS REST
// ==========================================

app.get('/qr', async (req, res) => {
    if (!qrData) {
        return res.send(`
            <h2 style="font-family:sans-serif; text-align:center; padding-top: 20vh;">
                ✅ Bot autenticado ${botReady ? '✅ LISTO' : '⏳ Inicializando...'}
            </h2>
        `);
    }

    try {
        const qrImage = await qrcode.toDataURL(qrData);
        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <title>Bot - QR</title>
                <meta http-equiv="refresh" content="10">
                <style>
                    body { font-family: sans-serif; background: #e5ddd5; 
                           display: flex; justify-content: center; align-items: center; 
                           height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; 
                            box-shadow: 0 10px 20px rgba(0,0,0,0.1); text-align: center; }
                    h2 { color: #075e54; }
                    img { max-width: 300px; margin: 20px 0; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>🤖 Bot WhatsApp</h2>
                    <img src="${qrImage}">
                    <p>Escanea con WhatsApp → Dispositivos vinculados</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error al generar QR');
    }
});

app.get('/status', (req, res) => {
    res.json({
        botReady: botReady,
        autenticado: client.info ? true : false,
        usuario: client.info?.wid?.user || null,
        gruposEnPolling: intervalosPolling.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/chats', async (req, res) => {
    if (!botReady) {
        return res.status(503).json({ error: 'Bot no está listo' });
    }

    try {
        const chats = await client.getChats();
        const chatList = chats.map(chat => ({
            nombre: chat.name,
            id: chat.id._serialized,
            esGrupo: chat.isGroup,
            enPolling: intervalosPolling.has(chat.id._serialized)
        }));

        res.json({ total: chats.length, chats: chatList });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/notificar', async (req, res) => {
    if (!botReady) {
        return res.status(503).json({ error: 'Bot no está listo' });
    }

    const { mensaje, grupoId } = req.body;
    
    if (!mensaje || !grupoId) {
        return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    try {
        await client.sendMessage(grupoId, mensaje);
        res.json({ status: 'Enviado', target: grupoId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/test', (req, res) => {
    res.json({ ok: true, botReady: botReady });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================

client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor en puerto ${PORT}`);
    console.log(`📊 Status: http://localhost:${PORT}/status`);
    console.log(`🗂️  Chats: http://localhost:${PORT}/chats\n`);
});