require('dotenv').config();
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const { verificarEnviarLembretes } = require('./lembretes.js');
const { gerarPayloadPix } = require('./pix.js');

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ [unhandledRejection] Erro não tratado capturado:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('⚠️ [uncaughtException] Exceção não capturada:', error.message || error);
});

const ID_BARBEARIA = process.env.ID_BARBEARIA || 1;

const PIX_CHAVE = process.env.PIX_CHAVE || '';
const PIX_NOME = (process.env.PIX_NOME || 'Barbearia Estilo').substring(0, 25);
const PIX_CIDADE = (process.env.PIX_CIDADE || 'Sao Paulo').substring(0, 15);

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'barbearia',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function ejecutarQuery(sql, params) {
    const [rows] = await pool.execute(sql, params);
    return rows;
}

function dividirMensagemEmBlocos(texto, tamanhoMax = 280) {
    if (texto.length <= tamanhoMax) return [texto];
    const paragrafos = texto.split('\n');
    const blocos = [];
    let blocoAtual = '';
    for (const p of paragrafos) {
        if ((blocoAtual + '\n' + p).trim().length > tamanhoMax) {
            if (blocoAtual) blocos.push(blocoAtual.trim());
            blocoAtual = p;
        } else {
            blocoAtual += (blocoAtual ? '\n' : '') + p;
        }
    }
    if (blocoAtual.trim()) blocos.push(blocoAtual.trim());
    return blocos;
}

async function atualizarStatusBot(status, qrBase64 = null) {
    try {
        await ejecutarQuery(
            `INSERT INTO bot_status (barbearia_id, status, qr_code_base64)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE status = VALUES(status), qr_code_base64 = VALUES(qr_code_base64)`,
            [ID_BARBEARIA, status, qrBase64]
        );
    } catch (err) {
        console.error('⚠️ Falha ao atualizar status do bot no banco:', err.message);
    }
}

async function enviarPagamentoAgendamento(destino, valor, txid, whatsappClienteLimpo) {
    if (!valor || valor <= 0) return;

    if (!PIX_CHAVE) {
        const msgSemPix = 'O pagamento pode ser realizado diretamente na barbearia, no momento do atendimento.';
        await client.sendMessage(destino, msgSemPix);
        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "model", ?)',
            [ID_BARBEARIA, whatsappClienteLimpo, msgSemPix]
        );
        return;
    }

    try {
        const payloadPix = gerarPayloadPix({ chave: PIX_CHAVE, nome: PIX_NOME, cidade: PIX_CIDADE, valor, txid });
        const qrDataUrl = await QRCode.toDataURL(payloadPix);
        const base64Data = qrDataUrl.split(',')[1];
        const media = new MessageMedia('image/png', base64Data, 'pix-qrcode.png');

        await client.sendMessage(destino, media, { caption: 'Segue o QR Code para pagamento via Pix.' });
        await new Promise(r => setTimeout(r, 600));
        await client.sendMessage(destino, `Código Pix Copia e Cola:\n\n${payloadPix}`);
        await new Promise(r => setTimeout(r, 600));
        const msgLocal = 'Caso prefira, o pagamento também pode ser realizado diretamente na barbearia, no momento do atendimento.';
        await client.sendMessage(destino, msgLocal);

        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "model", ?)',
            [ID_BARBEARIA, whatsappClienteLimpo, 'QR Code de pagamento via Pix e código copia-e-cola foram enviados ao cliente. Também foi informado que é possível pagar diretamente na barbearia.']
        );
    } catch (pixErr) {
        console.error('⚠️ Falha ao gerar/enviar QR Code PIX:', pixErr.message);
        const msgErro = 'Não foi possível gerar o QR Code no momento. O pagamento pode ser realizado diretamente na barbearia.';
        await client.sendMessage(destino, msgErro);
        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "model", ?)',
            [ID_BARBEARIA, whatsappClienteLimpo, msgErro]
        );
    }
}

async function processarRespostaLembrete(msg, whatsappClienteLimpo) {
    const texto = msg.body.trim();
    if (texto !== '1' && texto !== '2') return false;

    const agendamento = await ejecutarQuery(`
        SELECT a.id, a.data_hora
        FROM agendamentos a
        JOIN clientes c ON c.id = a.cliente_id
        WHERE c.whatsapp = ? AND a.barbearia_id = ?
          AND a.status = 'confirmado'
          AND (a.lembrete_24h_enviado = 1 OR a.lembrete_1h_enviado = 1)
          AND a.data_hora > NOW()
        ORDER BY a.data_hora ASC
        LIMIT 1
    `, [whatsappClienteLimpo, ID_BARBEARIA]);

    if (agendamento.length === 0) return false;

    const dataFormatada = new Date(agendamento[0].data_hora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

    if (texto === '1') {
        await msg.reply(`Presença confirmada para o agendamento de ${dataFormatada}. Aguardamos você.`);
    } else {
        await ejecutarQuery('UPDATE agendamentos SET status = "cancelado" WHERE id = ?', [agendamento[0].id]);
        await msg.reply(`Agendamento de ${dataFormatada} cancelado conforme solicitado. Caso deseje remarcar, é só nos avisar por aqui.`);
    }

    return true;
}

function iniciarWatchdog() {
    setInterval(async () => {
        try {
            const estado = await Promise.race([
                client.getState(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 20000))
            ]);
            console.log(`🩺 Watchdog: cliente respondendo normalmente (estado: ${estado}).`);
        } catch (err) {
            console.error('🚨 Watchdog: o cliente não respondeu a tempo. Reiniciando o processo...');
            process.exit(1);
        }
    }, 10 * 60 * 1000);
}

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './sessao_whatsapp'
    }),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined),
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

client.on('qr', (qr) => {
    const qrcode = require('qrcode-terminal');
    console.log('⚡ Escaneie o QR Code abaixo para conectar o WhatsApp:');
    qrcode.generate(qr, { small: true });

    QRCode.toDataURL(qr)
        .then(dataUrl => atualizarStatusBot('aguardando_qr', dataUrl))
        .catch(err => console.error('⚠️ Falha ao gerar QR Code em imagem:', err.message));
});

client.on('ready', () => {
    console.log('\n🟢 SUCESSO: O WhatsApp está conectado e inteligente!\n');

    atualizarStatusBot('conectado', null);

    verificarEnviarLembretes(client, ejecutarQuery, ID_BARBEARIA);
    setInterval(() => {
        verificarEnviarLembretes(client, ejecutarQuery, ID_BARBEARIA);
    }, 5 * 60 * 1000);

    iniciarWatchdog();
});

client.once('authenticated', () => {
    console.log('🔒 Sessão autenticada com sucesso!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente do WhatsApp foi desconectado:', reason);
    atualizarStatusBot('desconectado', null);
});

console.log('🤖 Iniciando o EstiloBot com IA e Banco de Dados Protegidos...');
client.initialize();

client.on('message_create', async (msg) => {
    if (msg.fromMe) return;
    if (msg.from.endsWith('@g.us') || msg.to.endsWith('@g.us')) return;

    try {
        try {
            const chat = await msg.getChat();
            if (chat && chat.isGroup) return;
        } catch (chatErr) {
            // Segue o atendimento normal
        }

        const destino = msg.from;
        const whatsappClienteLimpo = destino.split('@')[0];
        const mensagemCliente = msg.body;

        if (!mensagemCliente || mensagemCliente.trim() === '') return;

        const respostaLembreteTratada = await processarRespostaLembrete(msg, whatsappClienteLimpo);
        if (respostaLembreteTratada) return;

        const empresa = await ejecutarQuery('SELECT nome_comercial, mensagem_boas_vindas FROM empresas WHERE id = ?', [ID_BARBEARIA]);
        const nomeEmpresa = empresa.length > 0 ? empresa[0].nome_comercial : 'Barbearia Estilo';
        const mensagemPersonalizada = empresa.length > 0 && empresa[0].mensagem_boas_vindas
            ? empresa[0].mensagem_boas_vindas
            : null;

        let cortes = [];
        try {
            cortes = await ejecutarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes WHERE id_barbearia = ?', [ID_BARBEARIA]);
        } catch (corteErr) {
            try {
                cortes = await ejecutarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes WHERE barbearia_id = ?', [ID_BARBEARIA]);
            } catch (err2) {
                cortes = await ejecutarQuery('SELECT id, nome, preco, descricao, url_imagem FROM cortes', []);
            }
        }
        const listaCortesTexto = cortes.map(c => `- ID [${c.id}] ${c.nome}: R$ ${c.preco} (${c.descricao || 'Sem descrição'})`).join('\n');

        let clienteLogado = [];
        try {
            clienteLogado = await ejecutarQuery('SELECT id, nome FROM clientes WHERE id_barbearia = ? AND whatsapp = ?', [ID_BARBEARIA, whatsappClienteLimpo]);
        } catch (cliErr) {
            try {
                clienteLogado = await ejecutarQuery('SELECT id, nome FROM clientes WHERE barbearia_id = ? AND whatsapp = ?', [ID_BARBEARIA, whatsappClienteLimpo]);
            } catch (err2) {
                clienteLogado = await ejecutarQuery('SELECT id, nome FROM clientes WHERE whatsapp = ?', [whatsappClienteLimpo]);
            }
        }

        let dadosHistoricoPrompt = "Situação do cliente: trata-se de um cliente novo, sem histórico de atendimentos anteriores nesta barbearia.";
        let nomeCliente = "Cliente";
        let idClienteAtual = null;

        if (clienteLogado.length > 0) {
            idClienteAtual = clienteLogado[0].id;
            nomeCliente = clienteLogado[0].nome;

            let corteHabitual = [];
            let ultimoCorte = [];

            try {
                corteHabitual = await ejecutarQuery(`
                    SELECT agendamentos.id_corte, cortes.nome, COUNT(agendamentos.id_corte) as total 
                    FROM agendamentos 
                    JOIN cortes ON cortes.id = agendamentos.id_corte
                    WHERE agendamentos.cliente_id = ? AND agendamentos.id_corte IS NOT NULL
                    GROUP BY agendamentos.id_corte 
                    HAVING total >= 2
                    ORDER BY total DESC LIMIT 1`, [idClienteAtual]);

                ultimoCorte = await ejecutarQuery(`
                    SELECT agendamentos.id_corte, cortes.nome 
                    FROM agendamentos 
                    JOIN cortes ON cortes.id = agendamentos.id_corte
                    WHERE agendamentos.cliente_id = ? AND agendamentos.id_corte IS NOT NULL
                    ORDER BY agendamentos.id DESC LIMIT 1`, [idClienteAtual]);
            } catch (histErr) {
                console.warn('⚠️ Falha ao buscar histórico do cliente:', histErr.message);
            }

            if (corteHabitual.length > 0) {
                dadosHistoricoPrompt = `Situação do cliente: trata-se de um cliente já atendido anteriormente. O nome dele é ${nomeCliente}. O corte que ele realiza com mais frequência é "${corteHabitual[0].nome}".`;
            } else if (ultimoCorte.length > 0) {
                dadosHistoricoPrompt = `Situação do cliente: trata-se de um cliente já atendido anteriormente. O nome dele é ${nomeCliente}. O último corte realizado foi "${ultimoCorte[0].nome}".`;
            } else {
                dadosHistoricoPrompt = `O cliente chama-se ${nomeCliente}, porém ainda não possui registros de atendimentos anteriores.`;
            }
        } else {
            let nomeContato = 'Cliente';
            try {
                const contato = await msg.getContact();
                nomeContato = contato.pushname || contato.name || contato.shortName || 'Cliente';
            } catch (contatoErr) {
                console.warn('⚠️ Não foi possível obter o nome do contato:', contatoErr.message);
            }

            try {
                const resultado = await ejecutarQuery(
                    'INSERT INTO clientes (id_barbearia, nome, whatsapp) VALUES (?, ?, ?)',
                    [ID_BARBEARIA, nomeContato, whatsappClienteLimpo]
                );
                idClienteAtual = resultado.insertId;
                nomeCliente = nomeContato;
                dadosHistoricoPrompt = `Este é o primeiro contato deste cliente. O nome informado no WhatsApp é ${nomeCliente}.`;
            } catch (insertClienteErr) {
                if (insertClienteErr.code === 'ER_BAD_FIELD_ERROR') {
                    try {
                        const resultado2 = await ejecutarQuery(
                            'INSERT INTO clientes (barbearia_id, nome, whatsapp) VALUES (?, ?, ?)',
                            [ID_BARBEARIA, nomeContato, whatsappClienteLimpo]
                        );
                        idClienteAtual = resultado2.insertId;
                        nomeCliente = nomeContato;
                        dadosHistoricoPrompt = `Este é o primeiro contato deste cliente. O nome informado no WhatsApp é ${nomeCliente}.`;
                    } catch (err2) {
                        console.error('⚠️ Falha ao criar cliente automaticamente (fallback):', err2.message);
                    }
                } else if (insertClienteErr.code === 'ER_DUP_ENTRY' || insertClienteErr.errno === 1062) {
                    const clienteExistente = await ejecutarQuery('SELECT id, nome FROM clientes WHERE id_barbearia = ? AND whatsapp = ?', [ID_BARBEARIA, whatsappClienteLimpo]);
                    if (clienteExistente.length > 0) {
                        idClienteAtual = clienteExistente[0].id;
                        nomeCliente = clienteExistente[0].nome;
                    }
                } else {
                    console.error('⚠️ Falha ao criar cliente automaticamente:', insertClienteErr.message);
                }
            }
        }

        const barbeiros = await ejecutarQuery('SELECT id, nome, especialidade FROM barbeiros WHERE status = "ativo" OR status IS NULL', []);
        const listaBarbeirosTexto = barbeiros.map(b => `- ID [${b.id}] ${b.nome} (${b.especialidade || 'Geral'})`).join('\n');

        const horariosPadrao = ["13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"];
        const hoje = new Date().toISOString().split('T')[0];

        const agendamentosHoje = await ejecutarQuery(
            'SELECT data_hora FROM agendamentos WHERE DATE(data_hora) = ? AND status != "cancelado"',
            [hoje]
        );

        const horasOcupadas = agendamentosHoje.map(a => {
            const dataHora = new Date(a.data_hora);
            return dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        });

        const horariosLivres = horariosPadrao.filter(hora => !horasOcupadas.includes(hora));
        const listaHorariosTexto = horariosLivres.length > 0 ? horariosLivres.join(', ') : "Nenhum horário disponível para hoje.";

        await ejecutarQuery(
            'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "user", ?)',
            [ID_BARBEARIA, whatsappClienteLimpo, mensagemCliente]
        );

        const historico = await ejecutarQuery(
            'SELECT papel, mensagem FROM bot_historico_mensagens WHERE barbearia_id = ? AND cliente_identificador = ? ORDER BY id DESC LIMIT 6',
            [ID_BARBEARIA, whatsappClienteLimpo]
        );
        historico.reverse();
        const contextoHistorico = historico.map(h => `${h.papel === 'user' ? 'Cliente' : 'Assistente'}: ${h.mensagem}`).join('\n');

        const contextoSistema = `
        Você é o assistente virtual da barbearia "${nomeEmpresa}", identificado como "EstiloBot".
        Atenda o cliente de forma cordial, profissional e objetiva. Utilize um tom formal e educado, evitando gírias, expressões informais e uso excessivo de emojis (no máximo um, quando estritamente pertinente).
        ${mensagemPersonalizada ? `\nInformações específicas desta barbearia, a serem usadas quando pertinente na conversa (por exemplo, ao cumprimentar um cliente novo ou quando perguntado sobre localização/horário): "${mensagemPersonalizada}"` : ''}

        ${dadosHistoricoPrompt}

        Histórico recente da conversa com este cliente:
        ${contextoHistorico}
        
        Lista oficial de serviços, IDs e preços:
        ${listaCortesTexto}

        Lista de barbeiros disponíveis:
        ${listaBarbeirosTexto}
        
        Horários disponíveis para hoje (${hoje}):
        [ ${listaHorariosTexto} ]

        DIRETRIZES DE ATENDIMENTO:
        1. Caso seja um cliente novo, dê as boas-vindas de forma cordial e apresente as opções de corte disponíveis.
        2. Caso seja um cliente já atendido anteriormente, cumprimente-o pelo nome (${nomeCliente}) e pergunte se deseja repetir o corte habitual ou optar por outro.
        3. Após a definição do corte, apresente os barbeiros disponíveis e os horários livres.
        4. Ao mencionar ou confirmar um corte da lista, inclua ao final da resposta a tag: [ENVIAR_FOTO_ID: X] (onde X é o ID do corte). Utilize essa tag no máximo uma vez por resposta.
        5. Ao confirmar o agendamento (barbeiro, horário e corte definidos), inclua a tag:
           [AGENDAR_DATA_HORA: YYYY-MM-DD HH:MM | BARBEIRO_ID: X | CORTE_ID: Z]
        `;

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('⚠️ GEMINI_API_KEY não encontrada no arquivo .env');
            return;
        }

        // ATUALIZADO: gemini-2.0-flash foi descontinuado, trocado por gemini-3.6-flash
        const modelosParaTentar = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-3.6-flash'];
        let data = null;
        let ultimoErro = null;

        for (const nomeModelo of modelosParaTentar) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${nomeModelo}:generateContent?key=${apiKey}`;
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [
                                { text: contextoSistema },
                                { text: `Mensagem do Cliente: ${mensagemCliente}` }
                            ]
                        }]
                    })
                });

                if (response.ok) {
                    data = await response.json();
                    break;
                } else {
                    ultimoErro = await response.text();
                    console.warn(`⚠️ Modelo ${nomeModelo} indisponível. Tentando próximo...`);
                }
            } catch (fetchErr) {
                ultimoErro = fetchErr.message;
                console.warn(`⚠️ Falha na requisição ao modelo ${nomeModelo}:`, fetchErr.message);
            }
        }

        if (!data) {
            console.error('❌ Todos os modelos do Gemini falharam:', ultimoErro);
            await client.sendMessage(destino, 'No momento, estamos com instabilidade técnica. Poderia enviar sua mensagem novamente em alguns instantes?');
            return;
        }

        if (data.candidates && data.candidates[0]?.content?.parts) {
            let respostaIA = data.candidates[0].content.parts[0].text;

            let idCorteDetectado = null;
            const regexTagFotoCaptura = /\[ENVIAR_FOTO_ID:\s*(\d+)\]/;
            const matchFoto = respostaIA.match(regexTagFotoCaptura);
            if (matchFoto) {
                idCorteDetectado = matchFoto[1];
            }
            respostaIA = respostaIA.replace(/\[ENVIAR_FOTO_ID:\s*\d+\]/g, '').trim();

            const regexAgendamentoCaptura = /\[AGENDAR_DATA_HORA:\s*([\d-]+ [\d:]+)\s*\|\s*BARBEIRO_ID:\s*(\d+)\s*\|\s*CORTE_ID:\s*(\d+)\]/;
            const matchAgendamento = respostaIA.match(regexAgendamentoCaptura);

            let agendamentoConfirmado = false;
            let valorAgendamento = 0;
            let txidParaPix = null;

            if (matchAgendamento) {
                const dataHoraAgendamento = matchAgendamento[1];
                const idBarbeiroAgendamento = matchAgendamento[2];
                const idCorteAgendamento = matchAgendamento[3];

                respostaIA = respostaIA.replace(/\[AGENDAR_DATA_HORA:[^\]]+\]/g, '').trim();

                if (idClienteAtual) {
                    const corteEscolhido = cortes.find(c => c.id == idCorteAgendamento);
                    const precoCorte = corteEscolhido ? corteEscolhido.preco : 0.00;

                    const txidAgendamento = `AG${Date.now()}`;

                    try {
                        await ejecutarQuery(
                            `INSERT INTO agendamentos (barbearia_id, cliente_id, barbeiro_id, id_corte, data_hora, status, valor, metodo_pagamento, status_pagamento, pix_id_transacao) 
                             VALUES (?, ?, ?, ?, ?, 'confirmado', ?, 'pix', 'pendente', ?)`,
                            [ID_BARBEARIA, idClienteAtual, idBarbeiroAgendamento, idCorteAgendamento, `${dataHoraAgendamento}:00`, precoCorte, txidAgendamento]
                        );
                        console.log(`📅 Agendamento salvo com sucesso para as ${dataHoraAgendamento}!`);
                        agendamentoConfirmado = true;
                        valorAgendamento = precoCorte;
                        txidParaPix = txidAgendamento;
                    } catch (insertErr) {
                        if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
                            try {
                                await ejecutarQuery(
                                    `INSERT INTO agendamentos (id_barbearia, cliente_id, barbeiro_id, id_corte, data_hora, status, valor, metodo_pagamento, status_pagamento, pix_id_transacao) 
                                     VALUES (?, ?, ?, ?, ?, 'confirmado', ?, 'pix', 'pendente', ?)`,
                                    [ID_BARBEARIA, idClienteAtual, idBarbeiroAgendamento, idCorteAgendamento, `${dataHoraAgendamento}:00`, precoCorte, txidAgendamento]
                                );
                                console.log(`📅 Agendamento salvo via fallback para as ${dataHoraAgendamento}!`);
                                agendamentoConfirmado = true;
                                valorAgendamento = precoCorte;
                                txidParaPix = txidAgendamento;
                            } catch (err2) {
                                console.error('⚠️ Falha ao inserir agendamento:', err2.message);
                            }
                        } else if (insertErr.code === 'ER_DUP_ENTRY' || insertErr.errno === 1062) {
                            respostaIA += '\n\nInformamos que o horário selecionado acabou de ser reservado por outro cliente. Poderia, por gentileza, escolher outro horário?';
                        } else {
                            console.error('⚠️ Erro ao gravar agendamento:', insertErr.message);
                        }
                    }
                } else {
                    console.warn('⚠️ Não foi possível identificar/criar o cliente — agendamento não foi salvo.');
                }
            }

            respostaIA = respostaIA.replace(/\n{3,}/g, '\n\n').trim();

            if (!respostaIA.includes('EstiloBot')) {
                respostaIA += '\n\nAtenciosamente,\nEstiloBot';
            }

            await ejecutarQuery(
                'INSERT INTO bot_historico_mensagens (barbearia_id, cliente_identificador, papel, mensagem) VALUES (?, ?, "model", ?)',
                [ID_BARBEARIA, whatsappClienteLimpo, respostaIA]
            );

            const blocos = dividirMensagemEmBlocos(respostaIA);
            for (const bloco of blocos) {
                await client.sendMessage(destino, bloco);
                await new Promise(r => setTimeout(r, 800));
            }

            if (idCorteDetectado) {
                const corteEncontrado = cortes.find(c => c.id == idCorteDetectado);
                if (corteEncontrado && corteEncontrado.url_imagem && corteEncontrado.url_imagem.startsWith('http')) {
                    try {
                        const media = await MessageMedia.fromUrl(corteEncontrado.url_imagem);
                        await client.sendMessage(destino, media, { caption: `Exemplo de ${corteEncontrado.nome}` });
                    } catch (mediaErr) {
                        console.log('⚠️ URL da imagem do corte é inválida ou inacessível.');
                    }
                }
            }

            if (agendamentoConfirmado) {
                await enviarPagamentoAgendamento(destino, valorAgendamento, txidParaPix, whatsappClienteLimpo);
            }

            console.log(`🤖 Resposta enviada com sucesso para: ${whatsappClienteLimpo}`);
        } else {
            console.error('⚠️ Formato inesperado na resposta da API Gemini:', JSON.stringify(data));
        }

    } catch (error) {
        console.error('Erro no processamento da mensagem:', error.message || error);
    }
});