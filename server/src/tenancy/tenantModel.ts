import {
  type AnyBulkWriteOperation,
  type Model,
  type Query,
  type Schema,
  type SchemaType,
  type Types,
} from "mongoose";
import { isSystemContext, requireTenantId, TenantContextError } from "./tenantContext.js";
import { postgresModel } from "../persistence/postgresModel.js";

export interface TenantScopedDocument { tenantId: Types.ObjectId }

const tenantModels = new Set<Model<unknown>>();
const sameTenant = (value: unknown, tenantId: Types.ObjectId) => !value || value.toString() === tenantId.toString();

const assertTenantValue = (value: unknown, tenantId: Types.ObjectId): void => {
  if (!sameTenant(value, tenantId)) throw new TenantContextError("Cross-tenant database access was blocked");
};

const scopeFilter = (filter: Record<string, unknown>, tenantId: Types.ObjectId): void => {
  assertTenantValue(filter.tenantId, tenantId);
  filter.tenantId = tenantId;
};

const scopeUpdate = (update: Record<string, unknown> | unknown[], tenantId: Types.ObjectId, upsert: boolean): void => {
  if (Array.isArray(update)) {
    if (upsert) update.unshift({ $set: { tenantId: { $ifNull: ["$tenantId", tenantId] } } });
    return;
  }
  assertTenantValue(update.tenantId, tenantId);
  const set = update.$set as Record<string, unknown> | undefined;
  const unset = update.$unset as Record<string, unknown> | undefined;
  assertTenantValue(set?.tenantId, tenantId);
  if (unset?.tenantId !== undefined) throw new TenantContextError("A record cannot be detached from its tenant");
  if (upsert) {
    const setOnInsert = (update.$setOnInsert ??= {}) as Record<string, unknown>;
    assertTenantValue(setOnInsert.tenantId, tenantId);
    setOnInsert.tenantId = tenantId;
  }
};

const tenantForOperation = (): Types.ObjectId | undefined => {
  if (isSystemContext()) return undefined;
  return requireTenantId();
};

const prefixIndexesWithTenant = (schema: Schema): void => {
  const indexes = schema.indexes();
  for (const path of Object.values(schema.paths) as SchemaType[]) {
    // Index metadata has already been captured above. Clear path-level declarations
    // so only the tenant-aware equivalents are emitted by Mongoose.
    (path as SchemaType & { _index?: unknown })._index = null;
  }
  (schema as Schema & { _indexes: unknown[] })._indexes = [];

  schema.add({ tenantId: { type: "ObjectId", ref: "Tenant", required: true, immutable: true } });
  for (const [fields, options] of indexes) {
    // MongoDB TTL indexes must remain single-field indexes.
    if (options.expires !== undefined || options.expireAfterSeconds !== undefined) {
      schema.index(fields, options);
      continue;
    }
    if (Object.hasOwn(fields, "tenantId")) schema.index(fields, options);
    else schema.index({ tenantId: 1, ...fields }, { ...options, name: undefined });
  }
  schema.index({ tenantId: 1 });
};

const applyTenantPlugin = (schema: Schema): void => {
  prefixIndexesWithTenant(schema);

  schema.pre("validate", function () {
    if (isSystemContext()) {
      if (!this.get("tenantId")) throw new TenantContextError("System writes to tenant data must specify tenantId");
      return;
    }
    const tenantId = requireTenantId();
    assertTenantValue(this.get("tenantId"), tenantId);
    if (this.isNew) this.set("tenantId", tenantId);
  });

  const queryOperations = [
    "countDocuments", "deleteMany", "deleteOne", "distinct", "find", "findOne",
    "findOneAndDelete", "findOneAndReplace", "findOneAndUpdate", "replaceOne", "updateMany", "updateOne",
  ] as const;
  for (const operation of queryOperations) {
    schema.pre(operation, function (this: Query<unknown, unknown>) {
      const tenantId = tenantForOperation();
      if (!tenantId) return;
      const filter = this.getFilter() as Record<string, unknown>;
      scopeFilter(filter, tenantId);
      this.setQuery(filter);
      if (["findOneAndReplace", "findOneAndUpdate", "replaceOne", "updateMany", "updateOne"].includes(operation)) {
        const update = this.getUpdate() as Record<string, unknown> | unknown[] | null;
        if (update) scopeUpdate(update, tenantId, Boolean(this.getOptions().upsert));
      }
    });
  }

  schema.pre("aggregate", function () {
    const tenantId = tenantForOperation();
    if (!tenantId) return;
    const pipeline = this.pipeline();
    const match = { $match: { tenantId } };
    if (pipeline[0] && ("$geoNear" in pipeline[0] || "$search" in pipeline[0] || "$vectorSearch" in pipeline[0])) pipeline.splice(1, 0, match);
    else pipeline.unshift(match);
  });

  schema.pre("insertMany", function (next, documents: Record<string, unknown>[]) {
    const tenantId = tenantForOperation();
    if (!tenantId) {
      if (documents.some((document) => !document.tenantId)) throw new TenantContextError("System writes to tenant data must specify tenantId");
      next();
      return;
    }
    for (const document of documents) {
      assertTenantValue(document.tenantId, tenantId);
      document.tenantId = tenantId;
    }
    next();
  });

  schema.pre("bulkWrite", function (next, rawOperations) {
    const operations = rawOperations as AnyBulkWriteOperation<Record<string, unknown>>[];
    const tenantId = tenantForOperation();
    if (!tenantId) { next(); return; }
    for (const operation of operations) {
      if ("insertOne" in operation) {
        const document = operation.insertOne.document;
        assertTenantValue(document.tenantId, tenantId);
        document.tenantId = tenantId;
        continue;
      }
      const name = Object.keys(operation)[0] as keyof typeof operation;
      const item = operation[name] as { filter?: Record<string, unknown>; update?: Record<string, unknown> | unknown[]; replacement?: Record<string, unknown>; upsert?: boolean };
      if (item.filter) scopeFilter(item.filter, tenantId);
      if (item.update) scopeUpdate(item.update, tenantId, Boolean(item.upsert));
      if (item.replacement) {
        assertTenantValue(item.replacement.tenantId, tenantId);
        item.replacement.tenantId = tenantId;
      }
    }
    next();
  });
};

export const tenantModel = <T>(name: string, schema: Schema<T>): Model<T> => {
  applyTenantPlugin(schema);
  const compiled = postgresModel<T>(name, schema, true);
  tenantModels.add(compiled as Model<unknown>);
  return compiled;
};

export const getTenantModels = (): Model<unknown>[] => [...tenantModels];
