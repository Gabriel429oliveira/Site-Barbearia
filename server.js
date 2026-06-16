require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors'); 
// 1. Importa o SDK oficial da Google Gen AI
const { GoogleGenAI } = require('@google/genai'); 

const app = express();

app.use(cors()); 
app.use(express.json());

// Inicializa a Inteligência Artificial puxando a chave do .env
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Conexão ao Banco de Dados MySQL
const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '10Oliveira#', 
    database: 'barbearia',
    port: 3306
});

db.connect((err) => {
    if (err) return console.error('Erro no MySQL: ', err.message);
    console.log('🎉 Conectado ao MySQL com sucesso!');
});

// Helper para transformar as queries do banco em Promises
const executarQuery = (sql, params) => {
    return new Promise((resolve, reject) => {
        db.query(sql, params, (err, results) => {
            if (err) return reject(err);
            resolve(results);
        });
    });
};

// 2. ROTA CENTRAL DO CHAT (INTEGRADA COM O SDK RECENTE DO GEMINI)
app.post('/api/chat', async (req, res) => {
    const { mensagemCliente, whatsappCliente, idBarbearia } = req.body;

    if (!mensagemCliente || !whatsappCliente || !idBarbearia) {
        return res.status(400).json({ erro: 'Faltam parâmetros: mensagemCliente, whatsappCliente ou idBarbearia são obrigatórios.' });
    }

    try {
        // [PASSO A] Buscar dados da Empresa e seus Cortes
        const empresa = await executarQuery('SELECT nome_comercial FROM empresas WHERE id = ?', [idBarbearia]);
        if (empresa.length === 0) return res.status(404).json({ erro: 'Barbearia não cadastrada no sistema.' });
        
        const cortes = await executarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes WHERE id_barbearia = ?', [idBarbearia]);
        const listaCortesTexto = cortes.map(c => `- ID [${c.id}] ${c.nome}: R$ ${c.preco} (${c.descricao})`).join('\n');

        // [PASSO B] Verificar se o cliente já existe nesta barbearia
        const clienteLogado = await executarQuery('SELECT id, nome FROM clientes WHERE id_barbearia = ? AND whatsapp = ?', [idBarbearia, whatsappCliente]);

        let dadosHistoricoPrompt = "SITUAÇÃO DO CLIENTE: Este é um cliente NOVO. Ele não tem histórico de cortes na nossa barbearia.";
        let nomeCliente = "Cliente";

        if (clienteLogado.length > 0) {
            nomeCliente = clienteLogado[0].nome;
            const idCliente = clienteLogado[0].id;

            // 1. Tentar buscar o corte MAIS FEITO (Habitual) se ele veio mais de 2 vezes
            const corteHabitual = await executarQuery(`
                SELECT id_corte, cortes.nome, COUNT(id_corte) as total 
                FROM historico_agendamentos 
                JOIN cortes ON cortes.id = historico_agendamentos.id_corte
                WHERE historico_agendamentos.id_cliente = ? 
                GROUP BY id_corte 
                HAVING total >= 2
                ORDER BY total DESC LIMIT 1`, [idCliente]);

            // 2. Buscar o ÚLTIMO corte feito por ele
            const ultimoCorte = await executarQuery(`
                SELECT id_corte, cortes.nome 
                FROM historico_agendamentos 
                JOIN cortes ON cortes.id = historico_agendamentos.id_corte
                WHERE historico_agendamentos.id_cliente = ? 
                ORDER BY data_servico DESC LIMIT 1`, [idCliente]);

            if (corteHabitual.length > 0) {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: Este é um cliente ANTIGO. O nome dele é ${nomeCliente}. O corte que ele MAIS FAZ (Corte Habitual) é o "${corteHabitual[0].nome}".`;
            } else if (ultimoCorte.length > 0) {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: Este é um cliente ANTIGO. O nome dele é ${nomeCliente}. Ele ainda não tem um padrão fixo, mas o ÚLTIMO corte que ele realizou connosco na última visita foi o "${ultimoCorte[0].nome}".`;
            } else {
                dadosHistoricoPrompt = `SITUAÇÃO DO CLIENTE: O cliente chama-se ${nomeCliente}, mas ainda não realizou nenhum serviço connosco.`;
            }
        }

        // [PASSO C] Construir o Contexto do Prompt do Sistema
        const contextoSistema = `
        Tu és o "EstiloBot", o assistente inteligente da barbearia: "${empresa[0].nome_comercial}".
        
        ${dadosHistoricoPrompt}
        
        Aqui está a lista oficial de serviços, preços e IDs desta barbearia extraídos do banco de dados:
        ${listaCortesTexto}

        REGRAS DE ATENDIMENTO (Siga rigorosamente):
        1. Se for a primeira mensagem do cliente ou saudação, age conforme o histórico:
           - Se tiver CORTE HABITUAL: Pergunta amigavelmente se ele vai querer repetir o corte habitual dele (mencione o nome do corte).
           - Se tiver apenas ÚLTIMO CORTE: Pergunta se ele quer manter o último corte feito ou se quer mudar.
           - Se for CLIENTE NOVO: Dá as boas-vindas e faz perguntas curtas para entender o gosto dele (ex: estilo clássico ou moderno? curto ou comprido?) para chegares a uma recomendação ideal.
        2. Se o cliente pedir uma recomendação ou responder às tuas perguntas, analisa a nossa lista de cortes e sugere o que melhor se encaixa.
        3. Responde sempre de forma curta, prestativa e amigável.
        4. CRÍTICO: Quando tu decidires recomendar ou confirmar um corte específico da lista, inclui SEMPRE no final da tua resposta a tag exata do ID do corte desta forma: [ENVIAR_FOTO_ID: X] (onde X é o número do ID do corte). Não inventes IDs!
        `;

        // 3. Chamada utilizando a Biblioteca Oficial @google/genai
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: contextoSistema },
                        { text: `Mensagem enviada pelo Cliente (${nomeCliente}): ${mensagemCliente}` }
                    ]
                }
            ]
        });

        // Extrai o texto gerado de dentro da estrutura oficial de resposta do SDK
        let respostaIA = response.text;
        
        if (!respostaIA) {
            return res.status(500).json({ erro: 'Não foi possível gerar resposta através da IA.' });
        }

        // [PASSO D] Lógica de detecção de Tags de Imagem baseada no texto da IA
        let imagemParaEnviar = null;
        const regexTag = /\[ENVIAR_FOTO_ID:\s*(\d+)\]/;
        const match = respostaIA.match(regexTag);

        if (match) {
            const idCorteDetectado = match[1];
            const corteEncontrado = cortes.find(c => c.id == idCorteDetectado);
            if (corteEncontrado && corteEncontrado.url_imagem) {
                imagemParaEnviar = corteEncontrado.url_imagem;
            }
            respostaIA = respostaIA.replace(regexTag, '').trim();
        }

        // Retorna a resposta final limpa e o link da imagem anexada para o seu Front-end
        return res.json({ 
            resposta: respostaIA,
            anexo_imagem: imagemParaEnviar 
        });

    } catch (error) {
        console.error("Erro na rota de chat:", error);
        res.status(500).json({ erro: 'Erro interno no servidor: ' + error.message });
    }
});

// ROTA DE RELATÓRIOS (BI PREMIUM)
app.get('/api/relatorios/:idBarbearia', async (req, res) => {
    const { idBarbearia } = req.params;

    try {
        const totalClientesResult = await executarQuery(`
            SELECT COUNT(*) as total FROM clientes WHERE id_barbearia = ?
        `, [idBarbearia]);

        const faturamentoResult = await executarQuery(`
            SELECT SUM(valor_pago) as total, COUNT(*) as total_visitas 
            FROM historico_agendamentos 
            WHERE id_barbearia = ?
        `, [idBarbearia]);

        const faturamentoTotal = faturamentoResult[0].total || 0;
        const totalVisitas = faturamentoResult[0].total_visitas || 0;
        const ticketMedio = totalVisitas > 0 ? (faturamentoTotal / totalVisitas) : 0;

        const cortesMaisFeitos = await executarQuery(`
            SELECT cortes.nome, COUNT(historico_agendamentos.id_corte) as quantity
            FROM historico_agendamentos
            JOIN cortes ON cortes.id = historico_agendamentos.id_corte
            WHERE historico_agendamentos.id_barbearia = ?
            GROUP BY historico_agendamentos.id_corte
            ORDER BY quantity DESC
        `, [idBarbearia]);

        const clientesFieisResult = await executarQuery(`
            SELECT COUNT(*) as total_fieis FROM (
                SELECT id_cliente FROM historico_agendamentos 
                WHERE id_barbearia = ? 
                GROUP BY id_cliente 
                HAVING COUNT(id) >= 2
            ) as subquery
        `, [idBarbearia]);

        const totalClientes = totalClientesResult[0].total || 0;
        const totalFieis = clientesFieisResult[0].total_fieis || 0;
        const taxaRetencao = totalClientes > 0 ? ((totalFieis / totalClientes) * 100) : 0;

        const movimentoDias = await executarQuery(`
            SELECT DAYOFWEEK(data_servico) as dia_semana, COUNT(*) as quantidade
            FROM historico_agendamentos
            WHERE id_barbearia = ?
            GROUP BY dia_semana
            ORDER BY dia_semana
        `, [idBarbearia]);

        const dadosDiasVisitas = [0, 0, 0, 0, 0, 0, 0]; 

        movimentoDias.forEach(row => {
            if(row.dia_semana >= 1 && row.dia_semana <= 7) {
                dadosDiasVisitas[row.dia_semana - 1] = row.quantidade;
            }
        });

        res.json({
            totalClientes,
            faturamentoTotal,
            ticketMedio,
            taxaRetencao: taxaRetencao.toFixed(1), 
            rankingCortes: cortesMaisFeitos,
            graficoLinhaDias: {
                labels: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"],
                valores: dadosDiasVisitas.slice(1, 7) 
            }
        });

    } catch (error) {
        res.status(500).json({ erro: 'Erro ao gerar relatórios avançados: ' + error.message });
    }
});

// ROTA: BUSCAR CORTES POR BARBEARIA
app.get('/api/cortes/:idBarbearia', async (req, res) => {
    const { idBarbearia } = req.params;
    try {
        const cortes = await executarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes WHERE id_barbearia = ?', [idBarbearia]);
        res.json(cortes);
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao buscar cortes: ' + error.message });
    }
});

// ROTA: CADASTRAR NOVO CORTE
app.post('/api/cortes', async (req, res) => {
    const { id_barbearia, nome, preco, descricao, url_imagem } = req.body;

    if (!id_barbearia || !nome || !preco) {
        return res.status(400).json({ erro: 'Faltam parâmetros obrigatórios (id_barbearia, nome ou preco).' });
    }

    try {
        await executarQuery(
            'INSERT INTO cortes (id_barbearia, nome, preco, descricao, url_imagem) VALUES (?, ?, ?, ?, ?)',
            [id_barbearia, nome, preco, descricao, url_imagem]
        );
        res.status(201).json({ sucesso: true, mensagem: 'Corte cadastrado com sucesso!' });
    } catch (error) {
        res.status(500).json({ erro: 'Erro ao cadastrar corte: ' + error.message });
    }
});

const PORT = 2999;
app.listen(PORT, () => console.log(`🚀 Servidor backend multi-empresa rodando na porta ${PORT}`));