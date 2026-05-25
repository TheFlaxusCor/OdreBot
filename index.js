const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal'); // Lo mantenemos por consola
const qrcode = require('qrcode');                  // NUEVO: Generador PNG web
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

let qrData = null; // Variable global para almacenar el string del QR

// ==========================================
// SECCIÓN 1️⃣: LIMPIEZA PROFUNDA (FIX DE RAILWAY / ERROR 21)
// ==========================================
const authDir = path.join(__dirname, '.wwebjs_auth');

function limpiarCandadosRecursivo(directorio) {
    if (!fs.existsSync(directorio)) return;

    const archivos = fs.readdirSync(directorio);
    archivos.forEach(archivo => {
        const rutaCompleta = path.join(directorio, archivo);
        try {
            // Utilizamos lstatSync para evitar crasheos por enlaces rotos (ENOENT)
            const stat = fs.lstatSync(rutaCompleta);

            if (stat.isDirectory()) {
                limpiarCandadosRecursivo(rutaCompleta);
            } else {
                if (archivo.includes('SingletonLock') || archivo.includes('SingletonCookie')) {
                    fs.unlinkSync(rutaCompleta);
                    console.log(`🧹 Candado fantasma eliminado en: ${rutaCompleta}`);
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error(`⚠️ Advertencia en ${rutaCompleta}:`, err.message);
            }
        }
    });
}

console.log('Iniciando escaneo de candados persistentes...');
limpiarCandadosRecursivo(authDir);

// ==========================================
// SECCIÓN 2️⃣: CONFIGURACIÓN ROBUSTA DE CHROMIUM
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
            '--user-data-dir=/app/.wwebjs_auth' // Forzamos coincidencia con volumen
        ]
    }
});

// ==========================================
// SECCIÓN 3️⃣: EVENTOS DEL BOT 
// ==========================================
client.on('qr', qr => {
    qrData = qr; // Almacenamos el QR para servirlo en la web
    console.clear();
    console.log('\n╔════════════════════════════════════════════════╗');
    console.log('║               🔐 NUEVO CÓDIGO QR              ║');
    console.log('╚════════════════════════════════════════════════╝\n');
    console.log('🌐 Abre en tu navegador el dominio de Railway seguido de /qr');
    console.log('   Ejemplo: https://tu-app-bot.up.railway.app/qr');
    console.log('\nTambién puedes intentar escanear aquí abajo:');
    qrcodeTerminal.generate(qr, { small: true }); 
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa guardada localmente en el volumen');
    qrData = null; // Limpiamos la variable por seguridad
});

client.on('ready', () => {
    console.log('✅ ¡Bot en línea y listo para trabajar!');
});

// ==========================================
// SECCIÓN 4️⃣: ENDPOINTS (API REST & VISTA WEB)
// ==========================================

// 1. Endpoint Web: Ver el QR
app.get('/qr', async (req, res) => {
    // Si ya no hay QR, es porque ya está autenticado o apenas está cargando
    if (!qrData) {
        return res.send(`
            <h2 style="font-family:sans-serif; text-align:center; padding-top: 20vh;">
                ✅ El bot ya está autenticado o iniciando.<br>No se requiere escaneo.
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
                <title>Odrekao Bot - Escanear QR</title>
                <meta http-equiv="refresh" content="20"> 
                <style>
                    body { font-family: 'Segoe UI', sans-serif; background: #e5ddd5; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                    .card { background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 20px rgba(0,0,0,0.1); text-align: center; }
                    h2 { color: #075e54; margin-top: 0; }
                    img { border: 10px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.1); margin: 20px 0; }
                    .timer { color: #888; font-size: 0.9em; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h2>🤖 Odrekao WhatsApp Bot</h2>
                    <p>1. Abre WhatsApp en tu teléfono.<br>2. Ve a <b>Dispositivos vinculados</b>.<br>3. Escanea este código:</p>
                    <img src="${qrImage}" alt="Código QR">
                    <p class="timer">🔄 La página se recargará automáticamente en 20s</p>
                </div>
            </body>
            </html>
        `);
    } catch (err) {
        res.status(500).send('Error al generar la imagen del QR');
    }
});

// 2. Endpoint de Monitoreo
app.get('/status', (req, res) => {
    res.json({
        proyecto: "Odrekao",
        modulo: "Bot WhatsApp",
        autenticado: client.info ? true : false,
        estado: client.info ? "en_linea" : "esperando_qr",
        usuario: client.info ? client.info.wid.user : null
    });
});

// 3. Endpoint Principal: Enviar Mensajes
app.post('/notificar', async (req, res) => {
    // Validamos primero que el bot esté listo
    if (!client.info) {
        return res.status(503).json({ 
            error: 'El bot no está autenticado o sigue iniciando.',
            estado: 'esperando_autenticacion' 
        });
    }

    const { mensaje, grupoId } = req.body;
    if (!mensaje) {
        return res.status(400).json({ error: 'Falta el campo "mensaje"' });
    }

    try {
        const target = grupoId || '573132391143@c.us';
        await client.sendMessage(target, mensaje);
        console.log(`✉️ Mensaje enviado a ${target}`);
        res.status(200).json({ status: 'Mensaje enviado con éxito' });
    } catch (error) {
        console.error('❌ Error al enviar:', error);
        res.status(500).json({ error: 'Fallo al enviar mensaje', detalle: error.message });
    }
});

// ==========================================
// SECCIÓN 5️⃣: ARRANQUE DEL SISTEMA
// ==========================================
client.initialize();

// Railway inyecta el puerto dinámicamente en process.env.PORT (usualmente escucha en 8080)
const PORT = process.env.PORT || 8080; 
app.listen(PORT, () => {
    console.log(`🚀 Servidor API escuchando en el puerto ${PORT}`);
});