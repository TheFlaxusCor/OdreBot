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

// ==========================================
// SECCIÓN 1️⃣: LIMPIEZA PROFUNDA
// ==========================================
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
                console.error(`⚠️ Error en ${rutaCompleta}:`, err.message);
            }
        }
    });
}

console.log('🔍 Escaneando candados persistentes...');
limpiarCandadosRecursivo(authDir);

// ==========================================
// SECCIÓN 2️⃣: CONFIGURACIÓN DEL CLIENT
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
            '--disable-single-click-autofill',
            '--disable-extensions',
            '--user-data-dir=/app/.wwebjs_auth'
        ]
    }
});

// ==========================================
// SECCIÓN 3️⃣: EVENTOS DEL BOT
// ==========================================
client.on('qr', qr => {
    qrData = qr;
    console.clear();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║     🔐 ESCANEA EL CÓDIGO QR 👇         ║');
    console.log('╚════════════════════════════════════════╝\n');
    qrcodeTerminal.generate(qr, { small: true });
    const puertoActual = process.env.PORT || 3000;
    console.log(`\n✨ O accede a http://localhost:${puertoActual}/qr`);
    console.log('   para ver el código QR en el navegador\n');
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa guardada');
    qrData = null;
});

client.on('ready', () => {
    botReady = true;
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ ¡BOT EN LÍNEA Y LISTO!            ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log('📝 El bot ahora está escuchando mensajes en todos los chats');
    console.log('📝 Envía "hola" en cualquier chat o grupo\n');
});

client.on('auth_failure', (msg) => {
    console.error('❌ ERROR DE AUTENTICACIÓN:', msg);
});

client.on('disconnected', (reason) => {
    botReady = false;
    console.log('⚠️ Bot desconectado. Razón:', reason);
});

// ==========================================
// SECCIÓN 4️⃣: MANEJADOR DE MENSAJES
// ==========================================
client.on('message', async msg => {
    try {
        // Log IMPORTANTE: Todos los mensajes
        const tipoMensaje = msg.type || 'desconocido';
        const esGrupo = msg.from.includes('@g.us') ? '👥 GRUPO' : '👤 PRIVADO';
        
        console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📨 MENSAJE RECIBIDO`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📱 Tipo: ${esGrupo}`);
        console.log(`👤 De: ${msg.from}`);
        console.log(`📝 Texto original: "${msg.body}"`);
        console.log(`⏰ Tipo de mensaje: ${tipoMensaje}`);
        
        // Ignorar mensajes multimedia
        if (msg.type !== MessageTypes.TEXT && msg.type !== 'chat') {
            console.log(`⏭️  Ignorando (no es texto)`);
            return;
        }

        // Limpiar y normalizar el mensaje
        const mensajeLimpio = msg.body.trim().toLowerCase();
        console.log(`🔤 Texto limpio: "${mensajeLimpio}"`);

        // Responder a "hola"
        if (mensajeLimpio === 'hola') {
            const chat = await msg.getChat();
            const idChat = chat.id._serialized || chat.id;
            
            console.log(`✅ COMANDO DETECTADO: "hola"`);
            console.log(`📍 Chat: ${chat.name}`);
            console.log(`🔑 ID: ${idChat}`);

            const respuesta = 
                `🤖 *Info del Chat/Grupo*\n` +
                `Nombre: ${chat.name}\n` +
                `ID: *${idChat}*\n` +
                `Tipo: ${chat.isGroup ? '👥 Grupo' : '👤 Privado'}`;

            await msg.reply(respuesta);
            console.log(`✉️  Respuesta enviada correctamente`);
        } else {
            console.log(`❌ No coincide con comando "hola"`);
        }
        
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    } catch (error) {
        console.error('\n❌ ERROR AL PROCESAR MENSAJE:');
        console.error('Nombre:', error.name);
        console.error('Mensaje:', error.message);
        console.error('Stack:', error.stack);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
});

// Evento de ACK (confirmación de envío)
client.on('message_ack', (msg, ack) => {
    console.log(`📤 ACK de mensaje:`, ack);
});

// ==========================================
// SECCIÓN 5️⃣: ENDPOINTS REST
// ==========================================

// Endpoint: Ver QR
app.get('/qr', async (req, res) => {
    if (!qrData) {
        return res.send(`
            <h2 style="font-family:sans-serif; text-align:center; padding-top: 20vh;">
                ✅ El bot está autenticado<br>
                ${botReady ? '✅ BOT LISTO' : '⏳ Inicializando...'}
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
                <title>Odrekao Bot - QR</title>
                <meta http-equiv="refresh" content="20">
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #e5ddd5; 
                           display: flex; justify-content: center; align-items: center; 
                           height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; 
                            box-shadow: 0 10px 20px rgba(0,0,0,0.1); text-align: center; }
                    h2 { color: #075e54; margin-top: 0; }
                    img { border: 10px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.1); 
                          margin: 20px 0; max-width: 400px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>🤖 Odrekao WhatsApp Bot</h2>
                    <p>Abre WhatsApp → Dispositivos vinculados → Escanea:</p>
                    <img src="${qrImage}" alt="QR">
                    <p style="color: #888; font-size: 0.9em;">🔄 Se recarga automáticamente</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error al generar QR');
    }
});

// Endpoint: Status del bot
app.get('/status', (req, res) => {
    res.json({
        proyecto: "Odrekao",
        modulo: "Bot WhatsApp",
        autenticado: client.info ? true : false,
        botListo: botReady,
        usuario: client.info ? client.info.wid.user : null,
        timestamp: new Date().toISOString()
    });
});

// Endpoint: NUEVO - Listar todos los chats
app.get('/chats', async (req, res) => {
    try {
        if (!botReady) {
            return res.status(503).json({ error: 'Bot aún no está listo' });
        }

        const chats = await client.getChats();
        const chatList = chats.map(chat => ({
            nombre: chat.name,
            id: chat.id._serialized,
            esGrupo: chat.isGroup,
            mensajesSinLeer: chat.unreadCount
        }));

        res.json({
            total: chats.length,
            chats: chatList
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint: NUEVO - Debug de mensajes (ver últimos mensajes recibidos)
app.get('/debug/chats', async (req, res) => {
    try {
        if (!botReady) {
            return res.status(503).json({ error: 'Bot no está listo' });
        }

        const chats = await client.getChats();
        const detalles = [];

        for (const chat of chats.slice(0, 10)) {
            const mensajes = await chat.fetchMessages({ limit: 3 });
            detalles.push({
                nombre: chat.name,
                id: chat.id._serialized,
                esGrupo: chat.isGroup,
                ultimosMensajes: mensajes.map(m => ({
                    autor: m.from,
                    texto: m.body.substring(0, 50),
                    timestamp: new Date(m.timestamp * 1000).toISOString()
                }))
            });
        }

        res.json(detalles);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint: Enviar mensaje
app.post('/notificar', async (req, res) => {
    if (!botReady) {
        return res.status(503).json({
            error: 'El bot no está listo',
            estado: 'inicializando'
        });
    }

    const { mensaje, grupoId } = req.body;
    
    if (!mensaje) {
        return res.status(400).json({ error: 'Campo "mensaje" requerido' });
    }

    if (!grupoId) {
        return res.status(400).json({ error: 'Campo "grupoId" requerido' });
    }

    try {
        console.log(`📤 Enviando a ${grupoId}: ${mensaje}`);
        await client.sendMessage(grupoId, mensaje);
        res.json({ status: 'Enviado', target: grupoId });
    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint: Test
app.get('/test', (req, res) => {
    res.json({
        ok: true,
        botReady: botReady,
        autenticado: client.info ? true : false,
        puerto: process.env.PORT || 8080
    });
});

// ==========================================
// SECCIÓN 6️⃣: INICIAR SERVIDOR
// ==========================================
client.initialize();

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`\n🚀 Servidor escuchando en puerto ${PORT}`);
    console.log(`📊 Ver status: http://localhost:${PORT}/status`);
    console.log(`🗂️  Ver chats: http://localhost:${PORT}/chats`);
    console.log(`🔍 Ver debug: http://localhost:${PORT}/debug/chats`);
    console.log(`🧪 Test: http://localhost:${PORT}/test\n`);
});