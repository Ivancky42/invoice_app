-- Default CC list for invoice emails per company profile. Additive.

-- AlterTable
ALTER TABLE "CompanyProfile" ADD COLUMN "emailCc" TEXT;
