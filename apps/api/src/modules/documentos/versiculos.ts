/**
 * Palavra bíblica do rodapé dos documentos — um versículo sorteado a cada impressão, com a citação.
 * Pedido do Thiago (28/10/2026).
 */
export interface Versiculo {
  texto: string;
  ref: string;
}

export const VERSICULOS: Versiculo[] = [
  { texto: 'O Senhor é o meu pastor; nada me faltará.', ref: 'Salmos 23:1' },
  { texto: 'Tudo posso naquele que me fortalece.', ref: 'Filipenses 4:13' },
  { texto: 'Entrega o teu caminho ao Senhor; confia nele, e ele tudo fará.', ref: 'Salmos 37:5' },
  { texto: 'Porque Deus amou o mundo de tal maneira que deu o seu Filho unigênito, para que todo aquele que nele crê não pereça, mas tenha a vida eterna.', ref: 'João 3:16' },
  { texto: 'Confia no Senhor de todo o teu coração e não te estribes no teu próprio entendimento.', ref: 'Provérbios 3:5' },
  { texto: 'Lâmpada para os meus pés é a tua palavra e luz para o meu caminho.', ref: 'Salmos 119:105' },
  { texto: 'Sede fortes e corajosos; não temais, porque o Senhor, vosso Deus, é convosco.', ref: 'Josué 1:9' },
  { texto: 'O amor é paciente, o amor é bondoso.', ref: '1 Coríntios 13:4' },
  { texto: 'Vinde a mim, todos os que estais cansados e oprimidos, e eu vos aliviarei.', ref: 'Mateus 11:28' },
  { texto: 'Buscai primeiro o Reino de Deus e a sua justiça, e todas estas coisas vos serão acrescentadas.', ref: 'Mateus 6:33' },
  { texto: 'O Senhor te abençoe e te guarde.', ref: 'Números 6:24' },
  { texto: 'Alegrai-vos sempre no Senhor; outra vez digo: alegrai-vos.', ref: 'Filipenses 4:4' },
  { texto: 'Em tudo dai graças, porque esta é a vontade de Deus em Cristo Jesus para convosco.', ref: '1 Tessalonicenses 5:18' },
  { texto: 'Deus é o nosso refúgio e fortaleza, socorro bem presente na angústia.', ref: 'Salmos 46:1' },
  { texto: 'Eu sou o caminho, a verdade e a vida.', ref: 'João 14:6' },
  { texto: 'Lançando sobre ele toda a vossa ansiedade, porque ele tem cuidado de vós.', ref: '1 Pedro 5:7' },
  { texto: 'Os que esperam no Senhor renovarão as suas forças.', ref: 'Isaías 40:31' },
  { texto: 'Este é o dia que o Senhor fez; regozijemo-nos e alegremo-nos nele.', ref: 'Salmos 118:24' },
  { texto: 'Bem-aventurados os pacificadores, porque serão chamados filhos de Deus.', ref: 'Mateus 5:9' },
  { texto: 'Mais bem-aventurada coisa é dar do que receber.', ref: 'Atos 20:35' },
  { texto: 'O coração alegre aformoseia o rosto.', ref: 'Provérbios 15:13' },
  { texto: 'Tudo quanto fizerdes, fazei-o de todo o coração, como ao Senhor.', ref: 'Colossenses 3:23' },
  { texto: 'Não temas, porque eu sou contigo.', ref: 'Isaías 41:10' },
  { texto: 'O choro pode durar uma noite, mas a alegria vem pela manhã.', ref: 'Salmos 30:5' },
  { texto: 'Sabemos que todas as coisas contribuem juntamente para o bem daqueles que amam a Deus.', ref: 'Romanos 8:28' },
  { texto: 'Ainda que eu andasse pelo vale da sombra da morte, não temeria mal algum, porque tu estás comigo.', ref: 'Salmos 23:4' },
  { texto: 'Melhor é serem dois do que um.', ref: 'Eclesiastes 4:9' },
  { texto: 'Tudo tem o seu tempo determinado.', ref: 'Eclesiastes 3:1' },
  { texto: 'A resposta branda desvia o furor.', ref: 'Provérbios 15:1' },
  { texto: 'Deixo-vos a paz, a minha paz vos dou.', ref: 'João 14:27' },
  { texto: 'Pedi, e dar-se-vos-á; buscai e encontrareis; batei, e abrir-se-vos-á.', ref: 'Mateus 7:7' },
  { texto: 'Vós sois a luz do mundo.', ref: 'Mateus 5:14' },
  { texto: 'O Senhor é a minha luz e a minha salvação; a quem temerei?', ref: 'Salmos 27:1' },
  { texto: 'Grandes coisas fez o Senhor por nós, e por isso estamos alegres.', ref: 'Salmos 126:3' },
  { texto: 'A paz de Deus, que excede todo o entendimento, guardará o vosso coração.', ref: 'Filipenses 4:7' },
  { texto: 'Clama a mim, e responder-te-ei.', ref: 'Jeremias 33:3' },
  { texto: 'Bendize, ó minha alma, ao Senhor, e não te esqueças de nenhum de seus benefícios.', ref: 'Salmos 103:2' },
  { texto: 'Se Deus é por nós, quem será contra nós?', ref: 'Romanos 8:31' },
  { texto: 'A fé é o firme fundamento das coisas que se esperam.', ref: 'Hebreus 11:1' },
  { texto: 'Amarás o teu próximo como a ti mesmo.', ref: 'Marcos 12:31' },
  { texto: 'O Senhor é bom, uma fortaleza no dia da angústia.', ref: 'Naum 1:7' },
  { texto: 'Aquietai-vos e sabei que eu sou Deus.', ref: 'Salmos 46:10' },
  { texto: 'Não andeis ansiosos de coisa alguma.', ref: 'Filipenses 4:6' },
  { texto: 'Eu sei os planos que tenho para vós, planos de paz e não de mal, para vos dar o fim que esperais.', ref: 'Jeremias 29:11' },
  { texto: 'O Senhor guardará a tua entrada e a tua saída, desde agora e para sempre.', ref: 'Salmos 121:8' },
  { texto: 'Sede bondosos uns para com os outros.', ref: 'Efésios 4:32' },
  { texto: 'Eis que estou convosco todos os dias, até a consumação dos séculos.', ref: 'Mateus 28:20' },
  { texto: 'Provai e vede que o Senhor é bom.', ref: 'Salmos 34:8' },
  { texto: 'O temor do Senhor é o princípio da sabedoria.', ref: 'Provérbios 9:10' },
  { texto: 'Novas são as suas misericórdias a cada manhã; grande é a tua fidelidade.', ref: 'Lamentações 3:23' },
  { texto: 'Eu te louvarei, porque de um modo assombroso e maravilhoso fui feito.', ref: 'Salmos 139:14' },
  { texto: 'Onde estiver o vosso tesouro, aí estará também o vosso coração.', ref: 'Mateus 6:21' },
  { texto: 'O justo viverá da fé.', ref: 'Romanos 1:17' },
  { texto: 'Fiel é o que prometeu.', ref: 'Hebreus 10:23' },
  { texto: 'Combati o bom combate, acabei a carreira, guardei a fé.', ref: '2 Timóteo 4:7' },
  { texto: 'O Senhor pelejará por vós, e vós vos calareis.', ref: 'Êxodo 14:14' },
  { texto: 'A palavra do nosso Deus subsiste eternamente.', ref: 'Isaías 40:8' },
  { texto: 'Ensina-nos a contar os nossos dias, de tal maneira que alcancemos coração sábio.', ref: 'Salmos 90:12' },
  { texto: 'Assim brilhe a vossa luz diante dos homens.', ref: 'Mateus 5:16' },
  { texto: 'Graças a Deus pelo seu dom inefável.', ref: '2 Coríntios 9:15' },
];

export function sortearVersiculo(): Versiculo {
  return VERSICULOS[Math.floor(Math.random() * VERSICULOS.length)];
}
