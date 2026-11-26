-- AlterEnum: quotation outcomes. Converting a quotation to an invoice marks it ACCEPTED.
ALTER TYPE "DocumentStatus" ADD VALUE 'ACCEPTED';
ALTER TYPE "DocumentStatus" ADD VALUE 'DECLINED';
