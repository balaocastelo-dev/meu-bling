-- Celular (WhatsApp) no cadastro do usuário do sistema.
-- Usado pelo "chamar atenção" do chat da equipe.
-- O MEU BLING em desenvolvimento aplica o schema com `npx prisma db push` (apps/api).
-- Em um banco que já existe, este SQL só acrescenta a coluna — não apaga nada.

ALTER TABLE "Usuario" ADD COLUMN "telefone" TEXT;
