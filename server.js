require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const QRCode = require('qrcode');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Conexão com o Banco de Dados (createPool)
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'barbearia',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Helper para executar queries no MySQL via Promises
const ejecutarQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// Teste de conexão inicial com o pool
db.getConnection((err, connection) => {
    if (err) {
        console.error('Erro ao conectar ao Pool do MySQL:', err.message);
    } else {
        console.log('Conectado ao Pool do MySQL com sucesso!');
        connection.release();
    }
});

// Configuração opcional do Gemini AI
const apiKey = process.env.GEMINI_API_KEY;
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Rota de Agendamento
app.post('/api/agendamentos', async (req, res) => {
    const { 
        barbearia_id, 
        cliente_id, 
        barbeiro_id, 
        servico_id, 
        data, 
        hora, 
        valor, 
        metodo_pagamento 
    } = req.body;

    const data_hora = `${data} ${hora}:00`;
    const targetBarbeariaId = barbearia_id || 1;

    try {
        // Prevenção de Crashing (Trata retorno vazio da tabela empresas)
        const empresas = await ejecutarQuery('SELECT id FROM empresas WHERE id = ?', [targetBarbeariaId]);
        if (!empresas || empresas.length === 0) {
            console.warn(`Empresa ID ${targetBarbeariaId} não encontrada no banco. Usando ID padrão 1.`);
        }

        const queryInsert = `
            INSERT INTO agendamentos 
            (barbearia_id, cliente_id, barbeiro_id, data_hora, valor, metodo_pagamento, status) 
            VALUES (?, ?, ?, ?, ?, ?, 'pendente')
        `;

        await ejecutarQuery(queryInsert, [
            targetBarbeariaId, 
            cliente_id || 1, 
            barbeiro_id || 1, 
            data_hora, 
            valor || 0, 
            metodo_pagamento || 'local'
        ]);

        if (metodo_pagamento === 'pix') {
            const payloadPixFake = "00020126360014BR.GOV.BCB.PIX0114+5511942634316520400005303986540530.005802BR5916Barbearia Estilo6009Sao Paulo62070503***6304E2CA";
            
            try {
                const qrCodeBase64 = await QRCode.toDataURL(payloadPixFake);
                return res.json({
                    sucesso: true,
                    mensagem: 'Agendamento pré-reservado! Faça o pagamento via PIX para confirmar.',
                    metodo: 'pix',
                    pix_copia_e_cola: payloadPixFake,
                    pix_qr_code_base64: qrCodeBase64
                });
            } catch (qrErr) {
                console.error('Erro ao gerar QR Code:', qrErr);
                return res.json({
                    sucesso: true,
                    mensagem: 'Agendamento registrado, mas houve um erro ao gerar o QR Code do PIX.',
                    metodo: 'local'
                });
            }
        }

        return res.json({
            sucesso: true,
            mensagem: 'Agendamento realizado com sucesso! Aguardamos você no horário marcado.',
            metodo: 'local'
        });

    } catch (err) {
        // Trata o erro de horário duplicado (UNIQUE constraint no MySQL)
        if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
            return res.status(400).json({ 
                sucesso: false, 
                erro: 'Este horário já está reservado para este barbeiro. Por favor, escolha outro horário.' 
            });
        }
        console.error('Erro ao salvar agendamento:', err);
        return res.status(500).json({ sucesso: false, erro: 'Erro interno ao salvar o agendamento.' });
    }
});

// Rota do Chat (EstiloBot / Gemini IA)
app.post('/api/chat', async (req, res) => {
    const { mensagemCliente, barbearia_id } = req.body;
    const targetBarbeariaId = barbearia_id || 1;

    if (!mensagemCliente) {
        return res.status(400).json({ resposta: 'Mensagem inválida.' });
    }

    try {
        let nomeBarbearia = 'Barbearia Estilo';
        try {
            const empresas = await ejecutarQuery('SELECT nome FROM empresas WHERE id = ?', [targetBarbeariaId]);
            if (empresas && empresas.length > 0) {
                nomeBarbearia = empresas[0].nome;
            }
        } catch (dbErr) {
            console.warn('Não foi possível carregar dados da empresa no chat:', dbErr.message);
        }

        if (genAI) {
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const prompt = `Você é o assistente virtual da ${nomeBarbearia}. Responda à dúvida do cliente com cordialidade e objetividade.\nCliente: ${mensagemCliente}`;
                
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return res.json({ resposta: response.text() });
            } catch (aiErr) {
                console.error('Erro/Quota excedida na API Gemini:', aiErr.message);
                return res.json({
                    resposta: `Olá! Recebi sua mensagem na ${nomeBarbearia}. No momento nosso assistente automático está em alta demanda, mas em breve nossa equipe te atenderá!`
                });
            }
        }

        return res.json({
            resposta: `Olá! Bem-vindo à ${nomeBarbearia}. Recebi sua mensagem: "${mensagemCliente}". Em breve nossa equipe entrará em contato.`
        });

    } catch (err) {
        console.error('Erro na rota do chat:', err);
        return res.status(500).json({ resposta: 'Erro interno ao processar sua mensagem.' });
    }
});

// Inicialização do Servidor
const PORT = process.env.PORT || 2999;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});