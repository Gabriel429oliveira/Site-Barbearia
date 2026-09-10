document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // 1. GERENCIAMENTO DO MENU MOBILE
    // =========================================================================
    const menu = document.getElementById('menu');
    const menuOpen = document.getElementById('menu-mobile-open');
    const menuClose = document.getElementById('menu-mobile-close');

    if (menuOpen && menuClose && menu) {
        menuOpen.addEventListener('click', () => menu.classList.add('active'));
        menuClose.addEventListener('click', () => menu.classList.remove('active'));
    }

    const menuLinks = document.querySelectorAll('.menu ul li a');
    menuLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (menu) menu.classList.remove('active');
        });
    });

    // =========================================================================
    // 2. CRIAÇÃO DINÂMICA DO MODAL PIX (EVITA QUEBRA DE LAYOUT)
    // =========================================================================
    const estruturarModalPix = () => {
        if (document.getElementById('modal-pix-dinamico')) return;

        const modalHtml = `
            <div id="modal-pix-dinamico" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:9999; align-items:center; justify-content:center; padding:20px; font-family:'Roboto', sans-serif;">
                <div style="background:#222; color:#fff; padding:30px; border-radius:12px; max-width:400px; width:100%; text-align:center; box-shadow:0 10px 25px rgba(0,0,0,0.5); border:1px solid #ff4500;">
                    <h3 style="margin-top:0; color:#ff4500; font-size:22px; margin-bottom:15px;">Pagamento via PIX</h3>
                    <p style="font-size:14px; color:#ccc; margin-bottom:20px;">Escaneie o QR Code abaixo ou copie o código Pix para finalizar o agendamento.</p>
                    
                    <div style="background:#fff; padding:15px; border-radius:8px; display:inline-block; margin-bottom:20px;">
                        <img id="modal-pix-qrcode" src="" alt="QR Code Pix" style="width:200px; height:200px; display:block; object-fit:contain;">
                    </div>
                    
                    <button id="modal-pix-copiar" style="width:100%; background:#ff4500; color:#fff; border:none; padding:12px; border-radius:6px; font-weight:bold; cursor:pointer; margin-bottom:10px; font-size:14px; transition:0.2s;">
                        <i class="fa-solid fa-copy"></i> Copiar Código Pix
                    </button>
                    
                    <button id="modal-pix-fechar" style="width:100%; background:#444; color:#fff; border:none; padding:12px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:14px; transition:0.2s;">
                        Fechar Janela
                    </button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    };
    estruturarModalPix();

    // =========================================================================
    // 3. FLUXO DO FORMULÁRIO DE AGENDAMENTO
    // =========================================================================
    const formAgendamento = document.getElementById('form-agendamento');
    const selectServico = document.getElementById('agenda-servico');
    const inputValor = document.getElementById('agenda-valor');

    // Atualiza o valor invisível com base no atributo data-preco do serviço
    if (selectServico && inputValor) {
        selectServico.addEventListener('change', () => {
            const opcaoSelecionada = selectServico.options[selectServico.selectedIndex];
            const preco = opcaoSelecionada.dataset.preco;
            if (preco) inputValor.value = preco;
        });
    }

    if (formAgendamento) {
        formAgendamento.addEventListener('submit', async (e) => {
            e.preventDefault();

            const btnEnviar = document.getElementById('btn-enviar-agenda');
            if (btnEnviar) {
                btnEnviar.disabled = true;
                btnEnviar.innerText = "Processando...";
            }

            const formData = new FormData(formAgendamento);

            const dadosObjeto = {
                barbearia_id: parseInt(formData.get('barbearia_id') || 1),
                cliente_id: parseInt(formData.get('cliente_id') || 1),
                barbeiro_id: parseInt(formData.get('barbeiro_id') || 1),
                servico_id: parseInt(formData.get('servico')),
                data: formData.get('data'),
                hora: formData.get('horario'),
                valor: parseFloat(formData.get('valor') || 30),
                metodo_pagamento: formData.get('metodo_pagamento'),
                nome_cliente: formData.get('nome'),
                email_cliente: formData.get('email')
            };

            try {
                // 🔧 URL relativa: funciona em localhost e no domínio real sem precisar trocar nada
                const response = await fetch('/api/agendamentos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dadosObjeto)
                });

                const resultado = await response.json();

                if (resultado.sucesso) {
                    if (resultado.metodo === 'pix') {
                        const modal = document.getElementById('modal-pix-dinamico');
                        const imgQrCode = document.getElementById('modal-pix-qrcode');
                        const btnCopiar = document.getElementById('modal-pix-copiar');
                        const btnFechar = document.getElementById('modal-pix-fechar');

                        const textoPix = resultado.pix_copia_e_cola;
                        imgQrCode.src = resultado.pix_qr_code_base64;

                        btnCopiar.onclick = () => {
                            navigator.clipboard.writeText(textoPix);
                            alert("Código Copia e Cola copiado com sucesso!");
                        };

                        btnFechar.onclick = () => {
                            modal.style.display = 'none';
                            formAgendamento.reset();
                            window.location.reload();
                        };

                        modal.style.display = 'flex';
                    } else {
                        alert(resultado.mensagem || "Agendamento realizado com sucesso!");
                        formAgendamento.reset();
                        window.location.reload();
                    }
                } else {
                    alert("Erro: " + (resultado.erro || "Não foi possível agendar."));
                }
            } catch (error) {
                console.error("Erro na requisição:", error);
                alert("Erro ao conectar com o servidor.");
            } finally {
                if (btnEnviar) {
                    btnEnviar.disabled = false;
                    btnEnviar.innerText = "Confirmar Agendamento";
                }
            }
        });
    }

    // =========================================================================
    // 4. ESTRUTURAÇÃO DO CHAT INTELIGENTE (ESTILOBOT)
    // =========================================================================
    const estruturarChatBot = () => {
        if (document.getElementById('container-chat-estilo')) return;

        const chatHtml = `
            <div id="container-chat-estilo" style="position:fixed; bottom:20px; right:20px; z-index:9999; font-family:'Roboto', sans-serif;">
                <div id="btn-flutuante-chat" style="background:#ff4500; color:#fff; width:60px; height:60px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; cursor:pointer; box-shadow:0 4px 15px rgba(0,0,0,0.3); transition:0.3s;">
                    <i class="fa-solid fa-comments"></i>
                </div>
                
                <div id="janela-chat" style="display:none; flex-direction:column; position:absolute; bottom:75px; right:0; width:320px; height:430px; background:#1e1e1e; border:1px solid #ff4500; border-radius:12px; overflow:hidden; box-shadow:0 8px 25px rgba(0,0,0,0.4);">
                    <div style="background:#ff4500; color:#fff; padding:15px; font-weight:bold; display:flex; justify-content:space-between; align-items:center;">
                        <span><i class="fa-solid fa-robot"></i> EstiloBot</span>
                        <i class="fa-solid fa-xmark" id="fechar-janela-chat" style="cursor:pointer;"></i>
                    </div>
                    
                    <div id="corpo-mensagens-chat" style="flex:1; padding:15px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; background:#121212;">
                        <div style="background:#222; color:#fff; padding:10px; border-radius:8px; align-self:flex-start; max-width:85%; font-size:13px; line-height:1.4;">
                            Olá! Eu sou o EstiloBot. Como posso ajudar com o seu visual hoje?
                        </div>
                    </div>
                    
                    <div style="padding:10px; background:#1e1e1e; border-top:1px solid #333; display:flex; gap:5px;">
                        <input type="text" id="input-mensagem-chat" placeholder="Escreva a sua mensagem..." style="flex:1; padding:8px 12px; border-radius:20px; border:1px solid #444; background:#2a2a2a; color:#fff; font-size:13px; outline:none;">
                        <button id="btn-enviar-chat" style="background:#ff4500; color:#fff; border:none; width:35px; height:35px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer;">
                            <i class="fa-solid fa-paper-plane" style="font-size:12px;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', chatHtml);

        const btnFlutuante = document.getElementById('btn-flutuante-chat');
        const janelaChat = document.getElementById('janela-chat');
        const fecharChat = document.getElementById('fechar-janela-chat');
        const btnEnviarMsg = document.getElementById('btn-enviar-chat');
        const inputMsg = document.getElementById('input-mensagem-chat');
        const corpoMensagens = document.getElementById('corpo-mensagens-chat');

        btnFlutuante.addEventListener('click', () => {
            janelaChat.style.display = janelaChat.style.display === 'none' ? 'flex' : 'none';
        });
        fecharChat.addEventListener('click', () => {
            janelaChat.style.display = 'none';
        });

        // 🔧 Escapa o texto do usuário antes de inserir no HTML (evita injeção de tags no próprio chat)
        const escaparHtml = (texto) => {
            const div = document.createElement('div');
            div.textContent = texto;
            return div.innerHTML;
        };

        const processarEnvioChat = async () => {
            const texto = inputMsg.value.trim();
            if (!texto) return;

            corpoMensagens.insertAdjacentHTML('beforeend', `
                <div style="background:#ff4500; color:#fff; padding:10px; border-radius:8px; align-self:flex-end; max-width:85%; font-size:13px;">
                    ${escaparHtml(texto)}
                </div>
            `);
            inputMsg.value = '';
            corpoMensagens.scrollTop = corpoMensagens.scrollHeight;

            const digitandoId = 'id-' + Date.now();
            corpoMensagens.insertAdjacentHTML('beforeend', `
                <div id="${digitandoId}" style="background:#222; color:#aaa; padding:10px; border-radius:8px; align-self:flex-start; max-width:85%; font-size:13px; font-style:italic;">
                    Digitando...
                </div>
            `);
            corpoMensagens.scrollTop = corpoMensagens.scrollHeight;

            try {
                // 🔧 URL relativa (antes era http://localhost:2999/api/chat)
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mensagemCliente: texto,
                        idBarbearia: 1
                    })
                });

                const data = await response.json();
                const elementoDigitando = document.getElementById(digitandoId);
                if (elementoDigitando) elementoDigitando.remove();

                if (data.resposta) {
                    let conteudoResposta = `<p style="margin:0; line-height:1.4;">${escaparHtml(data.resposta)}</p>`;
                    if (data.anexo_imagem) {
                        conteudoResposta += `<img src="${data.anexo_imagem}" style="width:100%; border-radius:6px; margin-top:8px; display:block; max-height:150px; object-fit:cover;">`;
                    }

                    corpoMensagens.insertAdjacentHTML('beforeend', `
                        <div style="background:#222; color:#fff; padding:10px; border-radius:8px; align-self:flex-start; max-width:85%; font-size:13px;">
                            ${conteudoResposta}
                        </div>
                    `);
                }
            } catch (error) {
                const elementoDigitando = document.getElementById(digitandoId);
                if (elementoDigitando) elementoDigitando.remove();
                
                corpoMensagens.insertAdjacentHTML('beforeend', `
                    <div style="background:#222; color:#fff; padding:10px; border-radius:8px; align-self:flex-start; max-width:85%; font-size:13px; color:#ff4500;">
                        Erro ao conectar com o servidor.
                    </div>
                `);
            }
            corpoMensagens.scrollTop = corpoMensagens.scrollHeight;
        };

        btnEnviarMsg.addEventListener('click', processarEnvioChat);
        inputMsg.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') processarEnvioChat();
        });
    };
    estruturarChatBot();
});