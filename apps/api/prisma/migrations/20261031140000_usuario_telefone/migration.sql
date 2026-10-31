-- Celular (WhatsApp) no cadastro do usuário do sistema.
-- Usado pelo "chamar atenção" do chat da equipe.
-- Coluna opcional: quem já está cadastrado continua; o celular fica vazio até alguém preencher.
-- O container aplica este arquivo com `prisma migrate deploy` ao subir.
-- Não apaga linha e não recria a tabela Usuario.

ALTER TABLE "Usuario" ADD COLUMN "telefone" TEXT;
