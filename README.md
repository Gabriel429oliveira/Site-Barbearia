# 💈 Site Barbearia & EstiloBot 🤖

Plataforma SaaS de gestão para barbearias, com área administrativa completa e assistente virtual inteligente integrado ao WhatsApp.

O sistema permite que cada barbearia gerencie seu próprio negócio (agenda, clientes, cortes e histórico) enquanto a inteligência artificial cuida do atendimento: sugere cortes com base no histórico do cliente, consulta a disponibilidade de horários em tempo real e realiza agendamentos de forma 100% automatizada.



## 🚀 Funcionalidades Principais

*   **Atendimento Automatizado e Humanizado:** Integração com a API do Gemini para responder clientes de forma personalizada.
*   **Reconhecimento de Clientes:** Identifica se o cliente é novo ou antigo através do número de WhatsApp cadastrado no banco de dados.
*   **Histórico e Preferências:** IA sugere cortes baseando-se no corte habitual ou no último serviço realizado pelo cliente.
*   **Agenda Dinâmica:** Consulta a tabela de agendamentos no MySQL e exibe para o cliente apenas os horários realmente livres para o dia.
*   **Agendamento Automático:** Interpreta a confirmação do cliente e realiza o `INSERT` da reserva diretamente no banco de dados.
*   **Envio de Mídia:** Envia imagens de inspiração dos cortes disponíveis através do WhatsApp usando tags inteligentes.


## 🛠️ Tecnologias Utilizadas

*   **Backend:** Node.js
*   **Banco de Dados:** MySQL (Relacional)
*   **Inteligência Artificial:** Gemini API (`gemini-2.5-flash`)
*   **Automação de Mensagens:** `whatsapp-web.js` (Puppeteer para espelhamento de sessão)
*   **Segurança:** `dotenv` para gerenciamento de variáveis de ambiente

---

## 📂 Estrutura do Banco de Dados (MySQL)

O sistema conta com um banco de dados relacional chamado `barbearia`, estruturado com as seguintes tabelas:
*   `empresas`: Dados da barbearia.
*   `barbeiros`: Cadastro e status dos profissionais da casa.
*   `cortes`: Lista de serviços, preços e URLs das imagens.
*   `clientes`: Registro de clientes vinculados ao WhatsApp.
*   `agendamentos`: Controle de horários e status dos agendamentos efetuados.
*   `historico_agendamentos`: Registro histórico para alimentação da IA.

---

## 🔧 Como Executar o Projeto Localmente

1. **Clone o repositório:**
```bash
   git clone [https://github.com/seu-usuario/nome-do-repositorio.git](https://github.com/seu-usuario/nome-do-repositorio.git)
