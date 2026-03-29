const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

// ==================== SEGURANÇA: API Key via variável de ambiente ====================
const GROQ_API_KEY = process.env.GROQ_API_KEY;
if (!GROQ_API_KEY) {
    console.error('❌ ERRO: GROQ_API_KEY não configurada no ambiente!');
    process.exit(1);
}
// ====================================================================================

const sessions = new Map();

app.get('/', (req, res) => {
    res.json({ status: 'online', message: 'ClinicAI Backend is running!' });
});

app.get('/api/status/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    res.json({ status: session?.ready ? 'connected' : 'disconnected', ready: !!session?.ready });
});

app.post('/api/start', async (req, res) => {
    console.log('📱 POST /api/start recebido');
    const { sessionId, systemPrompt, clinicName, attendantName } = req.body;
    
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    if (sessions.has(sessionId)) return res.json({ success: true, message: 'Session active' });
    
    let qrSent = false;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: { 
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        }
    });
    
    client.on('qr', async (qr) => {
        console.log('📱 QR Code gerado');
        if (!qrSent) {
            qrSent = true;
            res.json({ success: true, qrCode: qr });
        }
    });
    
    client.on('ready', () => {
        console.log(`✅ WhatsApp conectado: ${sessionId}`);
        sessions.set(sessionId, { client, systemPrompt, clinicName, attendantName, ready: true });
    });
    
    client.on('message', async (message) => {
        const session = sessions.get(sessionId);
        if (!session?.ready || message.fromMe) return;
        
        console.log(`📩 Mensagem: ${message.body.substring(0, 50)}`);
        
        try {
            const prompt = (session.systemPrompt || 'Você é um atendente virtual')
                .replace(/{clinic_name}/g, session.clinicName || 'Clínica')
                .replace(/{attendant_name}/g, session.attendantName || 'Atendente');
            
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'mixtral-8x7b-32768',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: message.body }
                ],
                temperature: 0.7,
                max_tokens: 500
            }, {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
            
            await client.sendMessage(message.from, response.data.choices[0].message.content);
            console.log('📤 Resposta enviada');
        } catch (err) {
            console.error('Erro IA:', err.message);
            await client.sendMessage(message.from, 'Desculpe, estou com um problema técnico. Tente novamente em alguns instantes.');
        }
    });
    
    client.on('disconnected', () => {
        console.log(`❌ Desconectado: ${sessionId}`);
        sessions.delete(sessionId);
    });
    
    await client.initialize();
    
    setTimeout(() => {
        if (!qrSent) res.json({ success: true, message: 'Aguardando QR...', qrCode: null });
    }, 15000);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
