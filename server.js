// server.js - Backend completo para WhatsApp com IA
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Armazenar clientes ativos e suas configurações
const activeSessions = new Map();

// Endpoint para iniciar sessão do WhatsApp
app.post('/api/start', async (req, res) => {
    const { sessionId, apiKey, provider, model, systemPrompt, clinicName, attendantName, fullConfig } = req.body;
    
    if (activeSessions.has(sessionId)) {
        return res.json({ success: true, message: 'Sessão já ativa', qrCode: null });
    }
    
    let qrCodeGenerated = null;
    
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });
    
    client.on('qr', async (qr) => {
        console.log(`📱 QR Code gerado para ${sessionId}`);
        qrCodeGenerated = qr;
        // Enviar QR code via resposta HTTP (simplificado)
    });
    
    client.on('ready', () => {
        console.log(`✅ WhatsApp conectado para ${sessionId}`);
        activeSessions.set(sessionId, { 
            client, 
            apiKey, 
            provider, 
            model, 
            systemPrompt,
            clinicName,
            attendantName,
            fullConfig: JSON.parse(fullConfig || '{}'),
            isReady: true 
        });
    });
    
    client.on('message', async (message) => {
        const session = activeSessions.get(sessionId);
        if (!session || !session.isReady) return;
        
        // Ignorar mensagens enviadas por mim mesmo
        if (message.fromMe) return;
        
        const userMessage = message.body;
        const from = message.from;
        
        console.log(`📩 Mensagem de ${from}: ${userMessage}`);
        
        try {
            // Gerar resposta com IA
            const aiResponse = await callAI(userMessage, session);
            
            // Enviar resposta
            await client.sendMessage(from, aiResponse);
            console.log(`📤 Resposta enviada para ${from}`);
        } catch (error) {
            console.error('Erro ao processar mensagem:', error);
            await client.sendMessage(from, 'Desculpe, estou com um problema técnico. Tente novamente em alguns instantes.');
        }
    });
    
    client.on('disconnected', (reason) => {
        console.log(`❌ WhatsApp desconectado para ${sessionId}: ${reason}`);
        activeSessions.delete(sessionId);
    });
    
    await client.initialize();
    
    // Aguardar QR code
    setTimeout(() => {
        if (qrCodeGenerated) {
            res.json({ success: true, qrCode: qrCodeGenerated, message: 'QR Code gerado' });
        } else {
            res.json({ success: true, qrCode: null, message: 'Aguardando QR code...' });
        }
    }, 3000);
});

// Endpoint para verificar status
app.get('/api/status/:sessionId', (req, res) => {
    const session = activeSessions.get(req.params.sessionId);
    if (session && session.isReady) {
        res.json({ status: 'connected', ready: true });
    } else if (session) {
        res.json({ status: 'connecting', ready: false });
    } else {
        res.json({ status: 'disconnected', ready: false });
    }
});

// Endpoint para desconectar
app.post('/api/disconnect/:sessionId', async (req, res) => {
    const session = activeSessions.get(req.params.sessionId);
    if (session && session.client) {
        await session.client.destroy();
        activeSessions.delete(req.params.sessionId);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Função para chamar IA (Groq ou Google)
async function callAI(userMessage, session) {
    const { apiKey, provider, model, systemPrompt, clinicName, attendantName, fullConfig } = session;
    
    // Preparar o prompt do sistema com as configurações da clínica
    let finalSystemPrompt = systemPrompt
        .replace(/{clinic_name}/g, clinicName)
        .replace(/{attendant_name}/g, attendantName);
    
    // Adicionar informações da configuração
    if (fullConfig.servicesText) {
        finalSystemPrompt += `\n\nServiços disponíveis: ${fullConfig.servicesText}`;
    }
    if (fullConfig.scheduleText) {
        finalSystemPrompt += `\n\nHorários de funcionamento: ${fullConfig.scheduleText}`;
    }
    if (fullConfig.insurances && fullConfig.insurances.length > 0) {
        finalSystemPrompt += `\n\nConvênios aceitos: ${fullConfig.insurances.join(', ')}`;
    }
    
    try {
        if (provider === 'groq') {
            return await callGroqAPI(apiKey, model, finalSystemPrompt, userMessage);
        } else if (provider === 'google') {
            return await callGoogleAI(apiKey, model, finalSystemPrompt, userMessage);
        } else {
            return "Desculpe, provedor de IA não configurado.";
        }
    } catch (error) {
        console.error('Erro na chamada da IA:', error);
        return "Desculpe, estou com dificuldades técnicas. Por favor, tente novamente em alguns minutos.";
    }
}

// Chamada Groq API
async function callGroqAPI(apiKey, model, systemPrompt, userMessage) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: model || 'mixtral-8x7b-32768',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 500
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Erro Groq:', error.response?.data || error.message);
        return "Desculpe, erro ao processar sua mensagem. Tente novamente.";
    }
}

// Chamada Google Gemini API
async function callGoogleAI(apiKey, model, systemPrompt, userMessage) {
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const generativeModel = genAI.getGenerativeModel({ model: model || 'gemini-pro' });
        
        const fullPrompt = `${systemPrompt}\n\nPaciente: ${userMessage}\n\nAtendente:`;
        const result = await generativeModel.generateContent(fullPrompt);
        return result.response.text();
    } catch (error) {
        console.error('Erro Google AI:', error);
        return "Desculpe, erro ao processar sua mensagem. Tente novamente.";
    }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ClinicAI rodando na porta ${PORT}`);
    console.log(`📱 Endpoint: http://localhost:${PORT}/api/start`);
});