/**
 * Impressões da OS: via do cliente (completa, com garantia e assinatura),
 * via do técnico (sem valores) e etiqueta 80x50mm.
 */
import { cabecalhoEmpresa, dadosEmpresa, data, enderecoLinha, esc, formatarDocumento, formatarTelefone, moeda, paginaHtml, qtd } from '../comum/html.js';
import { linkPublico } from '../publico/token.js';
import type { carregarOs } from './service.js';

type Os = Awaited<ReturnType<typeof carregarOs>>;

const PRIORIDADE: Record<string, string> = { BAIXA: 'Baixa', NORMAL: 'Normal', ALTA: 'Alta', URGENTE: 'Urgente' };

function blocoCabecalho(os: Os, emp: Awaited<ReturnType<typeof dadosEmpresa>>, titulo: string) {
  return `
  <div class="cabecalho">
    ${cabecalhoEmpresa(emp)}
    <div class="doc">
      <div class="muted">${esc(titulo)}</div>
      <div class="numero">OS Nº ${os.numero}</div>
      <div>Entrada: ${data(os.dataEntrada)}${os.dataPrevista ? ' · Previsão: ' + data(os.dataPrevista) : ''}</div>
      <span class="sit" style="background:${esc(os.situacao.cor)}">${esc(os.situacao.nome)}</span>
      ${os.prioridade !== 'NORMAL' ? `<div class="muted">Prioridade: ${PRIORIDADE[os.prioridade] || os.prioridade}</div>` : ''}
    </div>
  </div>`;
}

function blocoCliente(os: Os, comContato = true) {
  const c = os.contato;
  return `
  <h2>Cliente</h2>
  <div class="grid">
    <div><b>Nome:</b> ${esc(c.nome)}</div>
    <div><b>${c.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}:</b> ${esc(formatarDocumento(c.documento)) || '-'}</div>
    ${comContato ? `<div><b>Telefone:</b> ${esc(formatarTelefone(c.celular || c.telefone)) || '-'}</div><div><b>E-mail:</b> ${esc(c.email || '-')}</div><div style="grid-column:1/-1"><b>Endereço:</b> ${esc(enderecoLinha(c)) || '-'}</div>` : `<div><b>Telefone:</b> ${esc(formatarTelefone(c.celular || c.telefone)) || '-'}</div>`}
  </div>`;
}

function blocoEquipamento(os: Os, comSenha: boolean) {
  return `
  <h2>Equipamento</h2>
  <div class="grid">
    <div><b>Equipamento:</b> ${esc(os.equipamento || '-')}</div>
    <div><b>Marca / Modelo:</b> ${esc([os.marca, os.modelo].filter(Boolean).join(' / ') || '-')}</div>
    <div><b>Nº de série:</b> ${esc(os.numeroSerie || '-')}</div>
    <div><b>Acessórios:</b> ${esc(os.acessorios || '-')}</div>
    <div><b>Estado físico:</b> ${esc(os.estadoFisico || '-')}</div>
    ${comSenha ? `<div><b>Senha:</b> ${esc(os.senhaEquipamento || '-')}</div>` : ''}
    ${os.tecnico ? `<div><b>Técnico:</b> ${esc(os.tecnico.nome)}</div>` : ''}
    ${os.vendedor ? `<div><b>Atendente:</b> ${esc(os.vendedor.nome)}</div>` : ''}
  </div>
  <h2>Defeito relatado</h2>
  <div class="obs">${esc(os.defeitoRelatado || '-')}</div>`;
}

export async function htmlOsCliente(os: Os): Promise<string> {
  const emp = await dadosEmpresa();
  const itens = os.itens
    .map(
      (i, idx) => `<tr><td class="num">${idx + 1}</td><td>${i.tipo === 'PECA' ? 'Peça' : 'Serviço'}</td><td>${esc(i.descricao)}</td><td class="num">${qtd(i.quantidade)}</td><td class="num">${moeda(i.valorUnitario)}</td><td class="num">${i.desconto ? moeda(i.desconto) : '-'}</td><td class="num">${moeda(i.total)}</td></tr>`,
    )
    .join('');
  const parcelas = os.parcelas
    .map((p) => `<tr><td>${p.numero}/${os.parcelas.length}</td><td>${data(p.dataVencimento)}</td><td>${esc(p.formaPagamento?.nome || '-')}</td><td class="num">${moeda(p.valor)}</td><td>${p.contaReceber ? esc(p.contaReceber.situacao) : ''}</td></tr>`)
    .join('');
  const link = linkPublico('os', os.id);
  const corpo = `
  ${blocoCabecalho(os, emp, 'ORDEM DE SERVIÇO — VIA DO CLIENTE')}
  ${blocoCliente(os)}
  ${blocoEquipamento(os, false)}
  ${os.diagnostico ? `<h2>Diagnóstico técnico</h2><div class="obs">${esc(os.diagnostico)}</div>` : ''}
  ${os.servicoExecutado ? `<h2>Serviço executado</h2><div class="obs">${esc(os.servicoExecutado)}</div>` : ''}
  ${
    os.itens.length
      ? `<h2>${os.orcar && !os.orcamentoAprovado ? 'Orçamento' : 'Serviços e peças'}</h2>
  <table><thead><tr><th class="num">#</th><th>Tipo</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Desc.</th><th class="num">Total</th></tr></thead><tbody>${itens}</tbody></table>
  <table class="totais">
    <tr><td>Serviços</td><td class="num">${moeda(os.totalServicos)}</td></tr>
    <tr><td>Peças</td><td class="num">${moeda(os.totalPecas)}</td></tr>
    ${os.descontoValor ? `<tr><td>Desconto</td><td class="num">- ${moeda(os.descontoValor)}</td></tr>` : ''}
    <tr class="total"><td>TOTAL</td><td class="num">${moeda(os.total)}</td></tr>
  </table>
  ${os.orcar ? `<div class="muted" style="margin-top:6px">Orçamento ${os.orcamentoAprovado ? `APROVADO${os.orcamentoAprovadoEm ? ' em ' + data(os.orcamentoAprovadoEm) : ''}${os.orcamentoAprovadoPor ? ' por ' + esc(os.orcamentoAprovadoPor) : ''}` : 'aguardando aprovação do cliente'}.</div>` : ''}`
      : ''
  }
  ${parcelas ? `<h2>Pagamento</h2><table><thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>${parcelas}</tbody></table>` : ''}
  ${os.observacoes ? `<h2>Observações</h2><div class="obs">${esc(os.observacoes)}</div>` : ''}

  <h2>Termos de garantia e condições</h2>
  <div class="termos">
    <p>1. Os serviços executados têm garantia de <b>${os.garantiaDias} dias</b> a contar da data de entrega, cobrindo exclusivamente o defeito reparado e as peças substituídas descritas nesta OS. Peças seguem a garantia do fabricante.</p>
    <p>2. A garantia não cobre danos causados por mau uso, quedas, líquidos, oscilação de energia, vírus, instalação de programas, violação do lacre ou intervenção de terceiros.</p>
    <p>3. O cliente declara estar ciente de que, em procedimentos de formatação, troca de disco ou reparo de placa, <b>pode haver perda de dados</b>. Recomenda-se backup prévio; a ${esc(emp.nome)} não se responsabiliza por arquivos, programas ou licenças.</p>
    <p>4. Orçamentos não aprovados ou equipamentos sem reparo poderão ter cobrança de taxa de análise/diagnóstico, informada no ato da entrada.</p>
    <p>5. Equipamentos não retirados em até <b>90 dias</b> após a comunicação de conclusão poderão ser vendidos para cobrir despesas de serviço e armazenamento, conforme art. 1.275 e 1.276 do Código Civil.</p>
    <p>6. A entrega do equipamento é feita mediante apresentação desta via ou documento com foto.</p>
    <p>Acompanhe sua OS pela internet: <b>${esc(link)}</b></p>
  </div>

  <div class="assinatura">
    <div>${esc(emp.nome)}<br><span class="muted">Responsável pelo atendimento</span></div>
    <div>${esc(os.contato.nome)}<br><span class="muted">Assinatura do cliente — declaro estar de acordo com os termos acima</span></div>
  </div>
  <div class="rodape">Emitido em ${data(new Date())} ${new Date().toLocaleTimeString('pt-BR')} — ${esc(emp.nome)}${emp.telefone ? ' · ' + esc(emp.telefone) : ''}</div>`;
  return paginaHtml(`OS nº ${os.numero} — via do cliente`, corpo, `.termos p { margin: 3px 0; font-size: 10.5px; line-height: 1.35; }`);
}

export async function htmlOsTecnico(os: Os): Promise<string> {
  const emp = await dadosEmpresa();
  const itens = os.itens
    .map((i, idx) => `<tr><td class="num">${idx + 1}</td><td>${i.tipo === 'PECA' ? 'Peça' : 'Serviço'}</td><td>${esc(i.descricao)}${i.produto?.codigo ? ` <span class="muted">(${esc(i.produto.codigo)})</span>` : ''}</td><td class="num">${qtd(i.quantidade)}</td><td>${i.tipo === 'PECA' ? (i.estoqueBaixado ? 'Baixada' : i.deposito?.nome || '') : ''}</td><td style="width:60px"><span class="check"></span></td></tr>`)
    .join('');
  const checklist = [
    'Liga / POST', 'Tela / vídeo', 'Teclado / touchpad', 'Portas USB', 'Áudio', 'Wi-Fi / rede', 'Bateria / carregador', 'HD/SSD (SMART)', 'Memória (teste)', 'Temperatura / cooler', 'Limpeza interna', 'Sistema operacional / drivers', 'Backup realizado', 'Testes finais',
  ]
    .map((c) => `<div class="chk"><span class="check"></span> ${c}</div>`)
    .join('');
  const corpo = `
  ${blocoCabecalho(os, emp, 'ORDEM DE SERVIÇO — VIA DO TÉCNICO')}
  ${blocoCliente(os, false)}
  ${blocoEquipamento(os, true)}
  <h2>Diagnóstico</h2>
  <div class="obs" style="min-height:70px">${esc(os.diagnostico || '')}</div>
  <h2>Serviço executado</h2>
  <div class="obs" style="min-height:70px">${esc(os.servicoExecutado || '')}</div>
  ${os.observacoesInternas ? `<h2>Observações internas</h2><div class="obs">${esc(os.observacoesInternas)}</div>` : ''}
  ${os.itens.length ? `<h2>Serviços e peças (sem valores)</h2><table><thead><tr><th class="num">#</th><th>Tipo</th><th>Descrição</th><th class="num">Qtd</th><th>Estoque</th><th>Feito</th></tr></thead><tbody>${itens}</tbody></table>` : ''}
  <h2>Checklist</h2>
  <div class="checklist">${checklist}</div>
  <div class="assinatura"><div>Técnico: ${esc(os.tecnico?.nome || '____________________')}</div><div>Data / hora de conclusão</div></div>
  <div class="rodape">Via interna — não entregar ao cliente. Emitido em ${data(new Date())}</div>`;
  return paginaHtml(
    `OS nº ${os.numero} — via do técnico`,
    corpo,
    `.check { display:inline-block; width:12px; height:12px; border:1px solid #111; vertical-align:middle; margin-right:4px; } .checklist { display:grid; grid-template-columns: repeat(3, 1fr); gap: 5px 12px; } .chk { font-size: 11.5px; }`,
  );
}

export async function htmlOsEtiqueta(os: Os): Promise<string> {
  const emp = await dadosEmpresa();
  const c = os.contato;
  const corpo = `
  <div class="etq">
    <div class="topo"><b>${esc(emp.nome)}</b><span>OS <b>${os.numero}</b></span></div>
    <div class="linha cliente">${esc(c.nome)}</div>
    <div class="linha">${esc([os.equipamento, os.marca, os.modelo].filter(Boolean).join(' ') || '-')}</div>
    ${os.numeroSerie ? `<div class="linha muted">S/N ${esc(os.numeroSerie)}</div>` : ''}
    <div class="linha">${esc(formatarTelefone(c.celular || c.telefone)) || ''}</div>
    <div class="base"><span>Entrada ${data(os.dataEntrada)}</span><span>${os.dataPrevista ? 'Prev. ' + data(os.dataPrevista) : ''}</span></div>
    ${os.senhaEquipamento ? `<div class="linha muted">Senha: ${esc(os.senhaEquipamento)}</div>` : ''}
  </div>`;
  const css = `
    @page { size: 80mm 50mm; margin: 2mm; }
    body { padding: 0; margin: 0; }
    .etq { width: 76mm; height: 46mm; padding: 2mm 3mm; box-sizing: border-box; border: 1px dashed #999; font-size: 11px; line-height: 1.25; overflow: hidden; }
    @media print { .etq { border: none; } }
    .topo { display:flex; justify-content:space-between; align-items:baseline; border-bottom: 1px solid #111; padding-bottom: 1mm; margin-bottom: 1mm; font-size: 12px; }
    .topo span b { font-size: 16px; }
    .linha { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cliente { font-weight: bold; font-size: 12px; }
    .base { display:flex; justify-content:space-between; margin-top: 1mm; font-size: 10px; }
  `;
  return paginaHtml(`Etiqueta OS ${os.numero}`, corpo, css);
}
