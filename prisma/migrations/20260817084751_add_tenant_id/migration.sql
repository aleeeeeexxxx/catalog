/*
  Warnings:

  - A unique constraint covering the columns `[tenantId,systemId,nativeUniqueName,deletedAt]` on the table `Resource` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,uniqueIdentifier,deletedAt]` on the table `System` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenantId` to the `Resource` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `System` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Resource_systemId_nativeUniqueName_deletedAt_key";

-- DropIndex
DROP INDEX "System_uniqueIdentifier_deletedAt_key";

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "System" ADD COLUMN     "tenantId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Resource_tenantId_systemId_nativeUniqueName_deletedAt_key" ON "Resource"("tenantId", "systemId", "nativeUniqueName", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "System_tenantId_uniqueIdentifier_deletedAt_key" ON "System"("tenantId", "uniqueIdentifier", "deletedAt");

ALTER TABLE "catalog"."System"
ENABLE ROW LEVEL SECURITY;

ALTER TABLE "catalog"."Resource"
ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_tenant_isolation
ON "catalog"."System"
USING (
    "tenantId" = current_setting('app.tenant_id')
)
WITH CHECK (
    "tenantId" = current_setting('app.tenant_id')
);

CREATE POLICY resource_tenant_isolation
ON "catalog"."Resource"
USING (
    "tenantId" = current_setting('app.tenant_id')
)
WITH CHECK (
    "tenantId" = current_setting('app.tenant_id')
);


