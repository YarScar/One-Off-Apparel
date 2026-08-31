-- CreateTable
CREATE TABLE "claude_csv_uploads" (
    "id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by_email" TEXT,
    "original_filename" TEXT,
    "covered_from" TIMESTAMP(3),
    "covered_to" TIMESTAMP(3),
    "row_count" INTEGER NOT NULL,

    CONSTRAINT "claude_csv_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claude_csv_usage_rows" (
    "id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "user_email" TEXT,
    "account_uuid" TEXT,
    "product_type" TEXT,
    "model" TEXT,
    "request_count" INTEGER,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "cost_usd" DECIMAL(12,4),
    "gross_spend_usd" DECIMAL(12,4),
    "row_data" JSONB NOT NULL,

    CONSTRAINT "claude_csv_usage_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claude_csv_uploads_uploaded_at_idx" ON "claude_csv_uploads"("uploaded_at");

-- CreateIndex
CREATE INDEX "claude_csv_usage_rows_upload_id_idx" ON "claude_csv_usage_rows"("upload_id");

-- CreateIndex
CREATE INDEX "claude_csv_usage_rows_user_email_idx" ON "claude_csv_usage_rows"("user_email");

-- AddForeignKey
ALTER TABLE "claude_csv_usage_rows" ADD CONSTRAINT "claude_csv_usage_rows_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "claude_csv_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
