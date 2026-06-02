module.exports = {
    apps: [{
        name: 'bot-odrekao',
        script: 'index.js',
        watch: false,
        max_memory_restart: '900M',   // ← Reinicia si supera 900MB
        node_args: '--max-old-space-size=512',  // ← Heap de Node limitado a 512MB
        env: {
            NODE_ENV: 'production',
            BACKEND_URL: 'https://backend-odrekao.fastapicloud.dev',
            BOT_API_KEY: 'odrekao_super_secreto'
        },
        restart_delay: 5000,    // Espera 5s antes de reiniciar
        max_restarts: 10,
        min_uptime: '30s'
    }]
};