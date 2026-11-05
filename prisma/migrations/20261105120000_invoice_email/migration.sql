-- CreateEnum
CREATE TYPE "InvoiceEmailStatus" AS ENUM ('SENT', 'FAILED');

-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN     "emailBcc" TEXT,
ADD COLUMN     "emailFrom" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "emailPending" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RecurringInvoice" ADD COLUMN     "autoEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailTo" TEXT;

-- CreateTable
CREATE TABLE "InvoiceEmail" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "InvoiceEmailStatus" NOT NULL,
    "trigger" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "bcc" TEXT,
    "subject" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEmail_documentId_createdAt_idx" ON "InvoiceEmail"("documentId", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceEmail" ADD CONSTRAINT "InvoiceEmail_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

