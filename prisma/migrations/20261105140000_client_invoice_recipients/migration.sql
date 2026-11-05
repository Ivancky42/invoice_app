-- Per-client invoice email recipients (To / CC). Additive.

-- AlterTable
ALTER TABLE "ClientProfile" ADD COLUMN "invoiceEmailCc" TEXT,
ADD COLUMN "invoiceEmailTo" TEXT;
