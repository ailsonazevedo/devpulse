-- AI Pulse: atribuição de atividades a ferramentas de IA.
ALTER TABLE "Activity" ADD COLUMN "aiTool" TEXT,
ADD COLUMN "aiSignal" TEXT;

CREATE INDEX "Activity_userId_aiTool_idx" ON "Activity"("userId", "aiTool");
