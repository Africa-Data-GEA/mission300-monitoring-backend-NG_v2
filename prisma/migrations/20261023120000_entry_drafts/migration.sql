CREATE TABLE "entry_drafts" (
    "obligationId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "savedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entry_drafts_pkey" PRIMARY KEY ("obligationId")
);

CREATE INDEX "entry_drafts_savedById_idx" ON "entry_drafts"("savedById");

ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entry_drafts" ADD CONSTRAINT "entry_drafts_savedById_fkey" FOREIGN KEY ("savedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
