# EstiloSaaS - Plataforma de Gestão Multi-Empresa para Barbearias 💇‍♂️📊

O **EstiloSaaS** é uma aplicação completa (Fullstack) projetada sob o modelo SaaS (Software as a Service) multi-empresa. O ecossistema integra um painel administrativo analítico em tempo real com um bot de atendimento inteligente integrado à API do Gemini, permitindo automação de respostas, leitura de histórico de clientes e recomendações dinâmicas baseadas no banco de dados.

---

## 🚀 Funcionalidades Principais

* **Painel de Business Intelligence (BI):** Dashboards analíticos com métricas críticas de negócios como Faturamento Total, Ticket Médio, Taxa de Retenção de Clientes e gráficos dinâmicos de pico de acessos.
* **Módulo Multi-Empresa (Multi-Tenant):** Arquitetura de banco de dados preparada para isolar e filtrar relatórios e serviços por ID de empresa dinamicamente.
* **CRUD de Serviços (Gerenciamento de Cortes):** Interface reativa para cadastro e listagem de serviços integrados diretamente ao banco de dados MySQL.
* **Atendimento Automatizado (IA):** Engine de Chat no Backend configurada para consuming a API do Gemini, contextualizando o bot com regras de negócio, histórico de visitas do cliente (Corte Habitual vs Último Corte) e envio de anexos de mídia.

---

## 🛠️ Stack Tecnológica

### Frontend
* **HTML5 & JavaScript ES6+** (Consumo assíncrono de APIs via Fetch)
* **Tailwind CSS v4** (Estilização moderna, utilitária e responsiva)
* **Chart.js** (Renderização e manipulação de gráficos de linha e doughnut)

### Backend & Banco de Dados
* **Node.js & Express** (Arquitetura RESTful para rotas de BI e CRUD)
* **MySQL** (Relacionamentos, Queries complexas com agrupamentos `GROUP BY` e condicionais `HAVING`)
* **Dotenv** (Gerenciamento seguro de variáveis de ambiente)
* **CORS** (Segurança e liberação de requisições Cross-Origin)

---

## 📐 Estrutura do Banco de Dados (Abstração)

A modelagem relacional do sistema foi estruturada para suportar o fluxo de dados entre empresas, clientes e serviços:
* `empresas`: Registra os estabelecimentos parceiros (Tenants).
* `cortes`: Armazena os serviços, valores e URLs de imagens vinculados a cada empresa.
* `clientes`: Gerencia a base de usuários finais vinculada a cada barbearia.
* `historico_agendamentos`: Tabela pivô contendo métricas transacionais de visitas, valores pagos e datas para alimentar o motor de BI.

---

## ⚙️ Como Executar o Projeto Localmente

### Pré-requisitos
* Node.js instalado
* Instância do MySQL ativa

### Passo a Passo

1. **Clone o repositório:**
```bash
   git clone [https://github.com/Gabriel429oliveira/Site-Barbearia.git](https://github.com/Gabriel429oliveira/Site-Barbearia.git)
   cd Site-Barbearia