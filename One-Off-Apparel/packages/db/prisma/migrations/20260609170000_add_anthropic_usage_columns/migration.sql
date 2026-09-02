-- AlterTable
ALTER TABLE "usage_logs"
    ADD COLUMN "anthropic_user_id" TEXT,
    ADD COLUMN "anthropic_user_email" TEXT,
    ADD COLUMN "anthropic_workspace" TEXT,
    ADD COLUMN "input_tokens" INTEGER,
    ADD COLUMN "output_tokens" INTEGER,
    ADD COLUMN "cache_read_tokens" INTEGER,
    ADD COLUMN "cache_creation_tokens" INTEGER,
    ADD COLUMN "model" TEXT;

-- CreateIndex
CREATE INDEX "usage_logs_anthropic_user_id_idx" ON "usage_logs"("anthropic_user_id");

-- CreateIndex
CREATE INDEX "usage_logs_anthropic_user_email_idx" ON "usage_logs"("anthropic_user_email");
