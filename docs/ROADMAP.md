# Roadmap — depois da primeira versão

## Antes de desligar o Bling (checklist)
- [ ] Rodar 2 semanas em paralelo: vendas e OS no MEU BLING, conferindo contas e estoque.
- [ ] NF-e em homologação (3+ notas autorizadas, 1 cancelamento, 1 carta de correção) → produção.
- [ ] NFC-e: solicitar CSC na SEFAZ-SP; testar QR Code no celular.
- [ ] Importar do Bling: contatos → produtos → estoque → vendas → contas → notas (nesta ordem).
- [ ] Conferir numeração: vendas (24838+), NF-e (série 4, nº 2206+).
- [ ] Agendar backup diário (Agendador de Tarefas → `scripts\backup.ps1`).
- [ ] Cadastrar usuários/perfis reais; trocar a senha do admin; guardar `apps/api/.env` em lugar seguro.

## Próximas entregas sugeridas
1. **PDV (frente de caixa)** — tela rápida com leitor de código de barras, NFC-e em 1 clique, sangria/abertura de caixa.
2. **Etiquetas e envios** — Correios/Melhor Envio/Jadlog (rastreio no WhatsApp).
3. **Marketplaces** — Mercado Livre/Shopee (pedidos entram como vendas com origem MARKETPLACE).
4. **Boleto/PIX com baixa automática** — via Open Finance (Pix recebido = baixa da conta) ou API do banco.
5. **Garantias e devoluções** — fluxo de troca/devolução gerando NF-e de devolução (finalidade 4).
6. **Portal do cliente** no site balao.info consumindo `/api/v1/publico/*` (acompanhar OS, 2ª via de nota).
7. **App técnico (celular)** — PWA do kanban de OS com fotos e assinatura do cliente.
8. **PostgreSQL + Docker** para múltiplos PCs com alto volume (hoje SQLite já atende a loja).
9. **Multiempresa** — se abrir CNPJ separado para a 2ª loja.
10. **IA local** — agente que responde WhatsApp consultando a OS/venda (Ollama), sugere categorias na conciliação e gera descrições de produto.
