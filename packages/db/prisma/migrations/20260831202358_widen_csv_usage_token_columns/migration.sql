-- AlterTable
ALTER TABLE "claude_csv_usage_rows" ALTER COLUMN "prompt_tokens" SET DATA TYPE BIGINT,
ALTER COLUMN "completion_tokens" SET DATA TYPE BIGINT;
