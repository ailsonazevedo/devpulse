-- Normalização de tipos de atividade para consistência multi-provider.
-- Não altera o schema (enum permanece), apenas remapeia linhas já ingeridas:
--   * MR (GitLab) → PR: unifica pull/merge request num único balde.
--   * PUSH do Azure → COMMIT: Azure ingere commits individuais, não eventos de push.
-- Idempotente: rodar de novo não tem efeito adicional.

UPDATE "Activity" SET "type" = 'PR' WHERE "type" = 'MR';

UPDATE "Activity"
SET "type" = 'COMMIT'
WHERE "provider" = 'AZURE' AND "type" = 'PUSH';
