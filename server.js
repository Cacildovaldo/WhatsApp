const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const GROQ_API_KEY = "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"; // COLE SUA CHAVE

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
    console.log('Body:', req.body);
    
    const { sessionId, systemPrompt, clinicName, attendantName } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId required' });
    }
    
    if (sessions.has(sessionId)) {
        return res.json({ success: true, message: 'Session already active' });
    }
    
    let qrSent = false;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: { 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] 
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
            const prompt = (session.systemPrompt || 'Você é um atendente')
                .replace(/{clinic_name}/g, session.clinicName || 'Clínica')
                .replace(/{attendant_name}/g, session.attendantName || 'Atendente');
            
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'mixtral-8x7b-32768',
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: message.body }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });
            
            await client.sendMessage(message.from, response.data.choices[0].message.content);
            console.log('📤 Resposta enviada');
        } catch (err) {
            console.error('Erro IA:', err.message);
            await client.sendMessage(message.from, 'Desculpe, tente novamente.');
        }
    });
    
    client.on('disconnected', () => {
        console.log(`❌ Desconectado: ${sessionId}`);
        sessions.delete(sessionId);
    });
    
    await client.initialize();
    
    setTimeout(() => {
        if (!qrSent) {
            res.json({ success: true, message: 'Waiting for QR code...', qrCode: null });
        }
    }, 15000);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
