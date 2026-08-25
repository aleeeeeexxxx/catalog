/*
  Warnings:

  - You are about to drop the column `desc` on the `Resource` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `Resource` table. All the data in the column will be lost.
  - You are about to alter the column `createdBy` on the `Resource` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(256)`.
  - You are about to alter the column `deletedBy` on the `Resource` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(256)`.
  - The `version` column on the `Resource` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Stage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `StagedResource` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `metadata` to the `Resource` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Resource" DROP COLUMN "desc",
DROP COLUMN "name",
ADD COLUMN     "metadata" TEXT NOT NULL,
ALTER COLUMN "createdBy" SET DATA TYPE VARCHAR(256),
ALTER COLUMN "deletedBy" SET DATA TYPE VARCHAR(256),
DROP COLUMN "version",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "stage"."Stage";

-- DropTable
DROP TABLE "stage"."StagedResource";

-- CreateTable
CREATE TABLE "ResourceRelationship" (
    "sourceId" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(32) NOT NULL,
    "type" VARCHAR(256) NOT NULL,

    CONSTRAINT "ResourceRelationship_pkey" PRIMARY KEY ("sourceId","targetId")
);

-- CreateTable
CREATE TABLE "stage"."StageResource" (
    "stageId" VARCHAR(32) NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "stageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startIngestAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "tenantId" VARCHAR(32) NOT NULL,
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
