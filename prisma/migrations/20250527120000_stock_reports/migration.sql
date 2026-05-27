-- CreateEnum
CREATE TYPE "StockReportType" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "StockReport" (
    "notionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reportType" "StockReportType" NOT NULL,
    "reportDate" TIMESTAMP(3),
    "content" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockReport_pkey" PRIMARY KEY ("notionId")
);

-- CreateIndex
CREATE INDEX "StockReport_reportType_idx" ON "StockReport"("reportType");

-- CreateIndex
CREATE INDEX "StockReport_reportDate_idx" ON "StockReport"("reportDate");
