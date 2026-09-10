# EstiloSaaS — Barbearia Estilo 🤖✂️

Plataforma SaaS de gestão para barbearias, com painel administrativo completo, pagamento via PIX e assistente virtual inteligente integrado ao WhatsApp.

O sistema permite que cada barbearia gerencie seu próprio negócio (agenda, clientes, cortes, faturamento e histórico) enquanto a inteligência artificial cuida do atendimento: sugere cortes com base no histórico do cliente, consulta a disponibilidade de horários em tempo real, realiza agendamentos de forma automatizada e envia lembretes antes do horário marcado.

## 🚀 Funcionalidades Principais

### Assistente Virtual (WhatsApp)
- **Atendimento automatizado e humanizado**, com tom formal e profissional, via API do Gemini (com fallback automático entre múltiplos modelos)
- **Memória de conversa**: o assistente lembra o contexto entre mensagens, mesmo após reinícios do sistema
- **Reconhecimento de clientes**: identifica automaticamente se o cliente é novo ou antigo pelo número de WhatsApp, cadastrando novos clientes sem intervenção manual
- **Histórico e preferências**: sugere o corte habitual ou o último serviço realizado
- **Agenda dinâmica em tempo real**, consultando os horários realmente livres no banco de dados
- **Agendamento automático**, com prevenção de conflito de horário (constraint de banco)
- **Pagamento via PIX direto no WhatsApp**: gera QR Code real e código copia-e-cola após a confirmação do agendamento
- **Lembretes automáticos** 24h e 1h antes do horário, com resposta rápida do cliente (1 = confirmar presença, 2 = cancelar)
- **Envio de imagens** dos cortes disponíveis via tags inteligentes
- **Reinício automático**: monitoramento de saúde do processo (watchdog) integrado ao PM2

### Painel Administrativo
- **Autenticação segura** com JWT e senhas criptografadas (bcrypt)
- **Relatórios em tempo real**: total de clientes, faturamento, ticket médio e taxa de retenção calculada dinamicamente
- **Gestão de cortes**: cadastro, edição e exclusão de serviços
- **Confirmação de pagamentos PIX** pendentes
- **Configuração da mensagem institucional** do assistente (endereço, horário de funcionamento, avisos), editável sem tocar no código
- **Conexão do WhatsApp via QR Code** direto na tela, sem precisar de terminal ou linha de comando

### Site Institucional
- Site público responsivo com seções de serviços, barbeiros, portfólio e agendamento
- Formulário de agendamento conectado à API, com opção de pagamento via PIX ou na barbearia
- Widget de chat com o assistente diretamente no site
- **PWA (Progressive Web App)**: o site pode ser instalado como aplicativo, direto do navegador

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js + Express
- **Banco de Dados**: MySQL (relacional)
- **Inteligência Artificial**: Gemini API, com fallback entre múltiplos modelos
- **Automação de Mensagens**: `whatsapp-web.js` (Puppeteer)
- **Autenticação**: JWT + bcrypt
- **Segurança**: Helmet (CSP), rate limiting, `dotenv` para variáveis de ambiente
- **Pagamentos**: geração própria de payload PIX (padrão EMV/CRC16), sem gateway externo
- **Gerenciamento de processo**: PM2, com monitoramento de saúde (watchdog)
- **PWA**: Service Worker + Web App Manifest

## 📂 Estrutura do Banco de Dados (MySQL)

Banco relacional `barbearia`, com as seguintes tabelas:

- `empresas`: dados da barbearia, incluindo mensagem institucional configurável
- `usuarios`: contas do painel administrativo
- `barbeiros`: cadastro e status dos profissionais
- `cortes`: serviços, preços e URLs de imagens
- `clientes`: clientes vinculados ao WhatsApp
- `agendamentos`: horários, status e dados de pagamento
- `historico_agendamentos`: histórico para personalização da IA
- `bot_historico_mensagens`: memória de conversa do assistente
- `bot_status`: status de conexão do WhatsApp (para o painel exibir o QR Code)

## 📁 Estrutura do Projeto

├── server.js # API principal (Express)
├── bot.js # Assistente do WhatsApp (processo separado)
├── lembretes.js # Rotina de lembretes automáticos
├── pix.js # Geração do payload PIX (compartilhado)
├── public/
│ ├── index.html # Site institucional
│ ├── modelos.html # Galeria de modelos de corte
│ ├── manifest.json # Configuração da PWA
│ ├── sw.js # Service Worker
│ ├── style.css
│ ├── menu.js
│ ├── imagens/
│ └── admin/ # Painel administrativo
│ ├── login.html
│ ├── relatorios.html
│ ├── cortes.html
│ └── bot.html


## 🔧 Como Executar o Projeto Localmente

1. Clone o repositório:
```bash
git clone https://github.com/Gabriel429oliveira/Site-Barbearia.git
```

2. Instale as dependências:
```bash
npm install
```

3. Crie um arquivo `.env` na raiz com as variáveis necessárias (banco de dados, chave da API Gemini, JWT secret, chave PIX). Consulte o código-fonte para a lista completa de variáveis usadas.

4. Inicie a API:
```bash
node server.js
```

5. Em um terminal separado, inicie o assistente do WhatsApp:
```bash
node bot.js
```

6. Acesse o site em `http://localhost:2999` e o painel em `http://localhost:2999/admin/login.html`.

## 👤 Autor

Desenvolvido por [Gabriel Oliveira](https://github.com/Gabriel429oliveira).