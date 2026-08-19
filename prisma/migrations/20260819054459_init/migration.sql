-- CreateTable
CREATE TABLE "System" (
    "id" VARCHAR(32) NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "type" VARCHAR(256) NOT NULL,
    "uniqueIdentifier" VARCHAR(256) NOT NULL,
    "connection" TEXT NOT NULL,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" VARCHAR(32) NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
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
CREATE UNIQUE INDEX "System_tenantId_uniqueIdentifier_deletedAt_key" ON "System"("tenantId", "uniqueIdentifier", "deletedAt");

-- CreateIndex
CREATE INDEX "Resource_systemId_id_idx" ON "Resource"("systemId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_tenantId_systemId_nativeUniqueName_deletedAt_key" ON "Resource"("tenantId", "systemId", "nativeUniqueName", "deletedAt");
