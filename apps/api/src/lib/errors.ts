/** Erro de negócio: vira HTTP 4xx com mensagem amigável em português. */
export class AppError extends Error {
  status: number;
  code: string;
  detalhes?: unknown;
  constructor(message: string, status = 400, code = 'ERRO', detalhes?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.detalhes = detalhes;
  }
}

export class NotFound extends AppError {
  constructor(entidade = 'Registro') {
    super(`${entidade} não encontrado(a).`, 404, 'NAO_ENCONTRADO');
  }
}

export class Forbidden extends AppError {
  constructor(msg = 'Sem permissão para esta ação.') {
    super(msg, 403, 'SEM_PERMISSAO');
  }
}
