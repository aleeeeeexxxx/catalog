/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,systemId,nativeUniqueName,deletedAt]` on the table `Resource` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,uniqueIdentifier,deletedAt]` on the table `System` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "Stage" (
    "id" VARCHAR(32) NOT NULL,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId" VARCHAR(32) NOT NULL,
    "systemId" VARCHAR(32) NOT NULL,
    "nativeUniqueName" VARCHAR(256) NOT NULL,
    "version" VARCHAR(256) NOT NULL,

    CONSTRAINT "Stage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagedResource" (
    "stageId" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "desc" TEXT NOT NULL,

    CONSTRAINT "StagedResource_pkey" PRIMARY KEY ("stageId")
);
