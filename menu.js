/**
 * Arquitetura de Scripts da Barbearia Estilo
 * Focado em Clean Code, Desempenho do DOM e Manipulação Assíncrona.
 */

document.addEventListener("DOMContentLoaded", () => {
    
    // Mapeamento dos nós do DOM de controle do Menu Mobile
    const btnOpenMenu = document.getElementById("menu-mobile-open");
    const btnCloseMenu = document.getElementById("menu-mobile-close");
    const navMenu = document.getElementById("menu");
    const linksMenu = document.querySelectorAll(".menu a");

    /**
     * Alternância de Estado do Menu Mobile (Abertura/Fechamento)
     */
    const toggleMenu = (open) => {
        if (open) {
            navMenu.classList.add("ativo");
            document.body.style.overflow = "hidden"; // Retém o scroll do body em segundo plano
        } else {
            navMenu.classList.remove("ativo");
            document.body.style.overflow = "auto"; // Libera o comportamento de scroll natural
        }
    };

    // Validação preventiva de existência de nós para evitar falhas silenciosas de execução
    if (btnOpenMenu && btnCloseMenu && navMenu) {
        btnOpenMenu.addEventListener("click", (e) => {
            e.preventDefault();
            toggleMenu(true);
        });

        btnCloseMenu.addEventListener("click", (e) => {
            e.preventDefault();
            toggleMenu(false);
        });
    }

    /**
     * Mecanismo de Rolagem Suave (Smooth Scroll) com Compensação do Cabeçalho Fixo
     */
    linksMenu.forEach(link => {
        link.addEventListener("click", function(e) {
            const targetId = this.getAttribute("href");
            
            if (targetId.startsWith("#")) {
                e.preventDefault();
                const targetElement = document.querySelector(targetId);

                if (targetElement) {
                    const cabecalhoElement = document.querySelector(".cabecalho");
                    const headerHeight = cabecalhoElement ? cabecalhoElement.offsetHeight : 0;
                    const elementPosition = targetElement.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - headerHeight;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: "smooth"
                    });
                }

                // Fecha a gaveta mobile de forma nativa após a seleção da rota interna
                toggleMenu(false);
            }
        });
    });

    /**
     * Gerenciador de Envio do Formulário via Requisições Assíncronas (Fetch API)
     * Abordagem Sênior: Integração direta com a API sem recarregar a tela.
     */
    const formAgendamento = document.getElementById("form-agendamento");
    const btnEnviar = document.getElementById("btn-enviar-agenda");

    if (formAgendamento) {
        formAgendamento.addEventListener("submit", function(e) {
            e.preventDefault(); 

            // Alteração de Estado Visual do Botão de Envio (UX Guard)
            if (btnEnviar) {
                btnEnviar.disabled = true;
                btnEnviar.innerText = "Processando Dados...";
            }

            // Captura reativa dos dados de entrada
            const formData = new FormData(this);

            // Chamada Assíncrona para o Endereço de Tratamento do Servidor
            fetch("salvar_agendamento.php", {
                method: "POST",
                body: formData
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error("Falha na comunicação de rede com o servidor.");
                }
                return response.text();
            })
            .then(data => {
                // Notificação de Sucesso via Feedback Nativo ao Usuário
                alert("Agendamento processado com sucesso!");
                formAgendamento.reset(); 
            })
            .catch(error => {
                // Tratamento e exibição de falhas na camada de infraestrutura
                console.error("Erro na operação de agendamento:", error);
                alert("Sistema temporariamente indisponível. Tente novamente mais tarde.");
            })
            .finally(() => {
                // Restauração do Estado Operacional do Botão de Envio
                if (btnEnviar) {
                    btnEnviar.disabled = false;
                    btnEnviar.innerText = "Confirmar Agendamento";
                }
            });
        });
    }
});