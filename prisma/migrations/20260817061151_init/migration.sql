-- CreateTable
CREATE TABLE "System" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "type" VARCHAR(256) NOT NULL,
    "uniqueIdentifier" VARCHAR(256) NOT NULL,
    "connection" TEXT NOT NULL,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "version" VARCHAR(256) NOT NULL,
    "nativeUniqueName" VARCHAR(256) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "desc" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "System_uniqueIdentifier_deletedAt_key" ON "System"("uniqueIdentifier", "deletedAt");

-- CreateIndex
CREATE INDEX "Resource_systemId_id_idx" ON "Resource"("systemId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_systemId_nativeUniqueName_deletedAt_key" ON "Resource"("systemId", "nativeUniqueName", "deletedAt");
