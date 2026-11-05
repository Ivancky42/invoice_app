-- Recurring invoice schedules. Additive only: new enums, a new table and two nullable
-- columns on "Document". Existing rows are untouched.

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "frequency" "RecurrenceFrequency" NOT NULL DEFAULT 'MONTHLY',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "maxOccurrences" INTEGER,
    "occurrencesGenerated" INTEGER NOT NULL DEFAULT 0,
    "nextRunDate" DATE,
    "lastRunDate" DATE,
    "autoIssue" BOOLEAN NOT NULL DEFAULT true,
    "dueInDays" INTEGER,
    "lastError" TEXT,
    "companyId" TEXT,
    "clientId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientAddress" TEXT,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "shipToAttn" TEXT,
    "shipToAddress" TEXT,
    "poNumber" TEXT,
    "projectTitle" TEXT,
    "projectDescription" TEXT,
    "items" JSONB NOT NULL,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENT',
    "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "sourceDocumentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Document" ADD COLUMN "recurringInvoiceId" TEXT,
ADD COLUMN "recurringRunDate" DATE;

-- CreateIndex
CREATE INDEX "RecurringInvoice_status_nextRunDate_idx" ON "RecurringInvoice"("status", "nextRunDate");

-- CreateIndex
CREATE UNIQUE INDEX "Document_recurringInvoiceId_recurringRunDate_key" ON "Document"("recurringInvoiceId", "recurringRunDate");

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "ClientProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
