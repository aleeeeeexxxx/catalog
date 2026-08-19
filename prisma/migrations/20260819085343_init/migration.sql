-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "stage";

-- CreateTable
CREATE TABLE "System" (
    "id" VARCHAR(32) NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "type" VARCHAR(256) NOT NULL,
    "uniqueIdentifier" VARCHAR(256) NOT NULL,

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

-- CreateTable
CREATE TABLE "stage"."Stage" (
    "id" VARCHAR(32) NOT NULL,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" VARCHAR(32) NOT NULL,
    "systemId" VARCHAR(32) NOT NULL,
    "nativeUniqueName" VARCHAR(256) NOT NULL,
    "version" VARCHAR(256) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage"."StagedResource" (
    "stageId" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "desc" TEXT NOT NULL,

    CONSTRAINT "StagedResource_pkey" PRIMARY KEY ("stageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "System_tenantId_uniqueIdentifier_key" ON "System"("tenantId", "uniqueIdentifier")
 WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Resource_tenantId_systemId_nativeUniqueName_key" ON "Resource"("tenantId", "systemId", "nativeUniqueName")
 WHERE "deletedAt" IS NULL;
