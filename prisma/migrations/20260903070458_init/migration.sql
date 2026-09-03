-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "stage";

-- CreateTable
CREATE TABLE "catalog"."System" (
    "id" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "tenantId" VARCHAR(32) NOT NULL,
    "type" VARCHAR(256) NOT NULL,
    "uniqueIdentifier" VARCHAR(256) NOT NULL,

    CONSTRAINT "System_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."Resource" (
    "id" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "systemId" TEXT NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
    "nativeUniqueName" VARCHAR(256) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."ResourceRelationship" (
    "sourceId" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(32) NOT NULL,
    "type" VARCHAR(256) NOT NULL,

    CONSTRAINT "ResourceRelationship_pkey" PRIMARY KEY ("sourceId","targetId")
);

-- CreateTable
CREATE TABLE "stage"."StageResource" (
    "stageId" VARCHAR(32) NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "workflowId" VARCHAR(32),
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startIngestAt" TIMESTAMP(3),
    "tenantId" VARCHAR(32) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "nativeUniqueName" VARCHAR(256) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "systemType" VARCHAR(256) NOT NULL,
    "systemTypeUniqueId" VARCHAR(256) NOT NULL,
    "metadata" TEXT NOT NULL,

    CONSTRAINT "StageResource_pkey" PRIMARY KEY ("stageId","id")
);

-- CreateTable
CREATE TABLE "stage"."StagedRelationship" (
    "stageId" VARCHAR(32) NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
    "sourceStageId" VARCHAR(32) NOT NULL,
    "targetStageId" VARCHAR(32) NOT NULL,
    "type" VARCHAR(256) NOT NULL,

    CONSTRAINT "StagedRelationship_pkey" PRIMARY KEY ("stageId","sourceStageId","targetStageId","type")
);

-- CreateTable
CREATE TABLE "stage"."StagedSystem" (
    "stageId" VARCHAR(32) NOT NULL,
    "stageResourceId" TEXT NOT NULL,
    "tenantId" VARCHAR(32) NOT NULL,
    "type" VARCHAR(256) NOT NULL,
    "uniqueIdentifier" VARCHAR(256) NOT NULL,

    CONSTRAINT "StagedSystem_pkey" PRIMARY KEY ("stageResourceId")
);

-- CreateIndex
CREATE UNIQUE INDEX "System_tenantId_uniqueIdentifier_key" ON "catalog"."System"("tenantId", "uniqueIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_tenantId_systemId_nativeUniqueName_key" ON "catalog"."Resource"("tenantId", "systemId", "nativeUniqueName");
