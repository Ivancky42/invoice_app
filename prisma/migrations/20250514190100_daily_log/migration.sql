-- CreateTable
CREATE TABLE "DailyLog" (
    "notionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "logDate" TIMESTAMP(3),
    "actionTaken" TEXT,
    "alertEmailSent" BOOLEAN,
    "flaggedTickers" TEXT,
    "flagsCount" INTEGER,
    "marketContext" TEXT,
    "notes" TEXT,
    "portfolioMove" TEXT,
    "topNews" TEXT,
    "watchlistMove" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("notionId")
);

-- CreateIndex
CREATE INDEX "DailyLog_logDate_idx" ON "DailyLog"("logDate");
