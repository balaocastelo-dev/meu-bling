/**
 * HTML imprimível do pedido de venda (A4).
 */
import { cabecalhoEmpresa, dadosEmpresa, data, enderecoLinha, esc, formatarDocumento, formatarTelefone, moeda, paginaHtml, qtd } from '../comum/html.js';
import { arredondar } from '../../lib/util.js';
import type { carregarVenda } from './service.js';

type Venda = Awaited<ReturnType<typeof carregarVenda>>;

export async function htmlVenda(v: Venda): Promise<string> {
  const emp = await dadosEmpresa();
  const c = v.contato;
  const descontoCalc = v.descontoTipo === 'PERCENTUAL' ? arredondar(v.totalProdutos * (v.descontoValor / 100)) : v.descontoValor;

  const itens = v.itens
    .map(
      (i, idx) => `
      <tr>
        <td class="num">${idx + 1}</td>
        <td>${esc(i.codigo || i.produto?.codigo || '')}</td>
        <td>${esc(i.descricao)}</td>
        <td class="num">${qtd(i.quantidade)} ${esc(i.unidade)}</td>
        <td class="num">${moeda(i.valorUnitario)}</td>
        <td class="num">${i.desconto ? moeda(i.desconto) : '-'}</td>
        <td class="num">${moeda(i.total)}</td>
      </tr>`,
    )
    .join('');

  const parcelas = v.parcelas
    .map(
      (p) => `
      <tr>
        <td>${p.numero}/${v.parcelas.length}</td>
        <td>${data(p.dataVencimento)}</td>
        <td>${esc(p.formaPagamento?.nome || '-')}</td>
        <td class="num">${moeda(p.valor)}</td>
        <td>${p.contaReceber ? esc(p.contaReceber.situacao) : ''}</td>
      </tr>`,
    )
    .join('');

  const corpo = `
  <div class="cabecalho">
    ${cabecalhoEmpresa(emp)}
    <div class="doc">
      <div class="muted">PEDIDO DE VENDA</div>
      <div class="numero">Nº ${v.numero}</div>
      <div>Data: ${data(v.data)}${v.dataPrevista ? ' · Previsão: ' + data(v.dataPrevista) : ''}</div>
      <span class="sit" style="background:${esc(v.situacao.cor)}">${esc(v.situacao.nome)}</span>
      ${v.nota ? `<div class="muted" style="margin-top:4px">NF-e ${v.nota.numero}/${v.nota.serie} — ${esc(v.nota.situacao)}</div>` : ''}
    </div>
  </div>

  <h2>Cliente</h2>
  <div class="grid">
    <div><b>Nome:</b> ${esc(c.nome)}${c.fantasia ? ' (' + esc(c.fantasia) + ')' : ''}</div>
    <div><b>${c.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}:</b> ${esc(formatarDocumento(c.documento)) || '-'}${c.ie ? ' · IE ' + esc(c.ie) : ''}</div>
    <div><b>Telefone:</b> ${esc(formatarTelefone(c.celular || c.telefone)) || '-'}</div>
    <div><b>E-mail:</b> ${esc(c.email || '-')}</div>
    <div style="grid-column: 1 / -1"><b>Endereço:</b> ${esc(enderecoLinha(c)) || '-'}</div>
    ${v.vendedor ? `<div><b>Vendedor:</b> ${esc(v.vendedor.nome)}</div>` : ''}
    <div><b>Origem:</b> ${esc(v.origem)}${v.numeroPedidoLoja ? ' · Pedido loja ' + esc(v.numeroPedidoLoja) : ''}</div>
  </div>

  <h2>Itens</h2>
  <table>
    <thead><tr><th class="num">#</th><th>Código</th><th>Descrição</th><th class="num">Qtd</th><th class="num">Unitário</th><th class="num">Desc.</th><th class="num">Total</th></tr></thead>
    <tbody>${itens}</tbody>
  </table>

  <table class="totais">
    <tr><td>Total dos produtos</td><td class="num">${moeda(v.totalProdutos)}</td></tr>
    ${descontoCalc ? `<tr><td>Desconto${v.descontoTipo === 'PERCENTUAL' ? ` (${v.descontoValor}%)` : ''}</td><td class="num">- ${moeda(descontoCalc)}</td></tr>` : ''}
    ${v.frete ? `<tr><td>Frete</td><td class="num">${moeda(v.frete)}</td></tr>` : ''}
    ${v.outrasDespesas ? `<tr><td>Outras despesas</td><td class="num">${moeda(v.outrasDespesas)}</td></tr>` : ''}
    <tr class="total"><td>TOTAL</td><td class="num">${moeda(v.total)}</td></tr>
  </table>

  <h2>Pagamento</h2>
  <table>
    <thead><tr><th>Parcela</th><th>Vencimento</th><th>Forma</th><th class="num">Valor</th><th>Situação</th></tr></thead>
    <tbody>${parcelas}</tbody>
  </table>

  ${
    v.transportadora || v.fretePorConta !== 9 || v.quantidadeVolumes
      ? `<h2>Transporte</h2>
  <div class="grid">
    <div><b>Transportadora:</b> ${esc(v.transportadora?.nome || '-')}</div>
    <div><b>Frete por conta:</b> ${fretePorConta(v.fretePorConta)}</div>
    <div><b>Volumes:</b> ${v.quantidadeVolumes || '-'}</div>
    <div><b>Peso bruto:</b> ${v.pesoBruto ? v.pesoBruto + ' kg' : '-'}</div>
  </div>`
      : ''
  }

  ${v.observacoes ? `<h2>Observações</h2><div class="obs">${esc(v.observacoes)}</div>` : ''}

  <div class="assinatura">
    <div>${esc(emp.nome)}</div>
    <div>${esc(c.nome)}<br><span class="muted">Recebi os produtos acima descritos</span></div>
  </div>
  <div class="rodape">Documento sem valor fiscal. Emitido em ${data(new Date())} ${new Date().toLocaleTimeString('pt-BR')} — ${esc(emp.nome)}</div>`;

  return paginaHtml(`Pedido de venda nº ${v.numero}`, corpo);
}

function fretePorConta(v: number) {
  return ({ 0: 'Emitente (CIF)', 1: 'Destinatário (FOB)', 2: 'Terceiros', 9: 'Sem frete' } as Record<number, string>)[v] || String(v);
}
