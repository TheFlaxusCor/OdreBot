const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const fs = require('fs'); // 🟢 NUEVO: Importamos fs para leer el sistema

const app = express();
app.use(express.json());

// 🟢 NUEVO: Buscador automático del navegador fantasma
const chromePath = fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' :
                   fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : 
                   undefined; // Si falla, usa el de Puppeteer nativo (que ahora sí funcionará porque instalamos los gráficos)

// 🟢 CONFIGURACIÓN A PRUEBA DE BALAS
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: chromePath, // 🟢 Se asigna automáticamente la ruta correcta
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// 3. EVENTO: BOT LISTO
client.on('ready', () => {
    console.log('✅ ¡Bot de WhatsApp de Odrekao en línea y enlazado!');
});

// 4. EL PUENTE DE COMUNICACIÓN (Endpoint para FastAPI)
app.post('/notificar', async (req, res) => {
    const { mensaje, grupoId } = req.body;
    
    if (!mensaje) {
        return res.status(400).json({ error: 'Falta el mensaje' });
    }

    try {
        // NOTA: Para las pruebas locales, puedes enviarte el mensaje a tu propio número.
        // El formato es: tunumero@c.us (ej. 573001234567@c.us)
        // Para grupos el formato es: id_del_grupo@g.us
        
        const target = grupoId || '573132391143@c.us'; 
        
        await client.sendMessage(target, mensaje);
        console.log(`✉️ Mensaje enviado con éxito: ${mensaje}`);
        res.status(200).json({ status: 'Mensaje enviado con éxito' });

    } catch (error) {
        console.error('❌ Fallo al enviar mensaje:', error);
        res.status(500).json({ error: 'Fallo al enviar mensaje', detalle: error.message });
    }
});

// 5. INICIAR SISTEMAS
client.initialize();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor puente escuchando en el puerto ${PORT}`));