/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic Mongoose-compatible adapter methods must accept heterogeneous model/query values. */
import mongoose, { type Model, type Schema } from "mongoose";
import { currentTenantId, isSystemContext, requireTenantId, TenantContextError } from "../tenancy/tenantContext.js";
import { postgres, quoteIdentifier } from "./postgres.js";

type Plain = Record<string, any>;
type Sort = Record<string, 1 | -1> | string;
type Projection = Record<string, 0 | 1> | string;
type Populate = string | { path: string; select?: Projection; match?: Plain; populate?: Populate | Populate[]; options?: { sort?: Sort; limit?: number } };

export interface RegisteredModel {
  name: string;
  table: string;
  tenantScoped: boolean;
  schema: Schema;
  model: Model<any>;
}

const registered = new Map<string, RegisteredModel>();
const SYSTEM_SCOPE = "__postgres_system_scope__";
const debug = (...values: unknown[]) => { if (process.env.POSTGRES_MODEL_DEBUG === "true") console.error("postgres-model", ...values); };
const objectId = () => new mongoose.Types.ObjectId();
export const castPostgresDistinctValue = (schema: Schema, path: string, value: any): any => {
  if (value == null || value instanceof mongoose.Types.ObjectId) return value;
  const schemaType = schema.path(path) as any;
  return path === "_id" || schemaType?.instance === "ObjectId" || schemaType?.caster?.instance === "ObjectId"
    ? new mongoose.Types.ObjectId(String(value))
    : value;
};
const scalar = (value: any): any => value instanceof mongoose.Types.ObjectId ? value.toString() : value instanceof Date ? value.getTime() : value;
const equal = (left: any, right: any): boolean => {
  if (Array.isArray(left)) return left.some((item) => equal(item, right));
  if (Array.isArray(right)) return right.some((item) => equal(left, item));
  if (left === null || left === undefined || right === null || right === undefined) return left == right;
  return scalar(left) === scalar(right);
};

const valuesAt = (source: any, path: string): any[] => {
  const parts = path.split(".");
  let values = [source];
  for (const part of parts) {
    values = values.flatMap((value) => {
      if (Array.isArray(value)) return value.flatMap((item) => item?.[part]);
      return value == null ? [] : [value[part]];
    }).filter((value) => value !== undefined);
  }
  return values;
};
const valueAt = (source: any, path: string): any => valuesAt(source, path)[0];
const setAt = (source: Plain, path: string, value: any): void => {
  const parts = path.split("."); let cursor: any = source;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]!] ??= {};
  cursor[parts.at(-1)!] = value;
};
const unsetAt = (source: Plain, path: string): void => {
  const parts = path.split("."); let cursor: any = source;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor?.[parts[index]!] ;
  if (cursor) delete cursor[parts.at(-1)!];
};

const compare = (actual: any, condition: any): boolean => {
  if (condition instanceof RegExp) return condition.test(String(actual ?? ""));
  if (!condition || typeof condition !== "object" || condition instanceof Date || condition instanceof mongoose.Types.ObjectId || Array.isArray(condition)) return equal(actual, condition);
  const regex = condition.$regex instanceof RegExp ? condition.$regex : condition.$regex !== undefined ? new RegExp(String(condition.$regex), condition.$options ?? "") : undefined;
  if (regex && !regex.test(String(actual ?? ""))) return false;
  for (const [operator, expected] of Object.entries(condition)) {
    if (["$regex", "$options"].includes(operator)) continue;
    const a = scalar(actual); const e = scalar(expected);
    if (operator === "$eq" && !equal(actual, expected)) return false;
    if (operator === "$ne" && equal(actual, expected)) return false;
    if (operator === "$gt" && !(a > e)) return false;
    if (operator === "$gte" && !(a >= e)) return false;
    if (operator === "$lt" && !(a < e)) return false;
    if (operator === "$lte" && !(a <= e)) return false;
    if (operator === "$in" && !(expected as any[]).some((item) => compare(actual, item))) return false;
    if (operator === "$nin" && (expected as any[]).some((item) => compare(actual, item))) return false;
    if (operator === "$exists" && Boolean(actual !== undefined && actual !== null) !== Boolean(expected)) return false;
    if (operator === "$size" && (!Array.isArray(actual) || actual.length !== Number(expected))) return false;
    if (operator === "$all" && (!(expected as any[]).every((item) => Array.isArray(actual) && actual.some((entry) => compare(entry, item))))) return false;
    if (operator === "$elemMatch" && (!Array.isArray(actual) || !actual.some((item) => matches(item, expected as Plain)))) return false;
    if (operator === "$not" && compare(actual, expected)) return false;
  }
  return true;
};

const expression = (document: Plain, expr: any, variables: Plain = {}): any => {
  if (typeof expr === "string" && expr === "$$ROOT") return document;
  if (typeof expr === "string" && expr.startsWith("$$")) return variables[expr.slice(2)];
  if (typeof expr === "string" && expr.startsWith("$")) return valueAt(document, expr.slice(1));
  if (Array.isArray(expr)) return expr.map((item) => expression(document, item, variables));
  if (!expr || typeof expr !== "object" || expr instanceof Date) return expr;
  if (expr.$eq) { const [a, b] = expression(document, expr.$eq, variables); return equal(a, b); }
  if (expr.$and) return expression(document, expr.$and, variables).every(Boolean);
  if (expr.$or) return expression(document, expr.$or, variables).some(Boolean);
  if (expr.$ifNull) { const [a, b] = expression(document, expr.$ifNull, variables); return a ?? b; }
  if (expr.$add) return expression(document, expr.$add, variables).reduce((sum: number, item: any) => sum + Number(item ?? 0), 0);
  if (expr.$cond) { const [test, yes, no] = expr.$cond; return expression(document, expression(document, test, variables) ? yes : no, variables); }
  if (expr.$dateToString) {
    const date = new Date(expression(document, expr.$dateToString.date, variables));
    const format = expr.$dateToString.format;
    return format === "%Y-%m" ? date.toISOString().slice(0, 7) : date.toISOString();
  }
  if (expr.$size !== undefined) return (expression(document, expr.$size, variables) ?? []).length;
  return Object.fromEntries(Object.entries(expr).map(([key, value]) => [key, expression(document, value, variables)]));
};

const matches = (document: Plain, filter: Plain = {}, variables: Plain = {}): boolean => {
  for (const [path, condition] of Object.entries(filter ?? {})) {
    if (path === "$or" && !(condition as Plain[]).some((item) => matches(document, item, variables))) return false;
    else if (path === "$and" && !(condition as Plain[]).every((item) => matches(document, item, variables))) return false;
    else if (path === "$nor" && (condition as Plain[]).some((item) => matches(document, item, variables))) return false;
    else if (path === "$expr" && !expression(document, condition, variables)) return false;
    else if (!path.startsWith("$")) {
      const values = valuesAt(document, path);
      const existsCheck = condition && typeof condition === "object" && "$exists" in condition;
      if (!values.length && !(existsCheck && compare(undefined, condition))) return false;
      if (values.length && !values.some((value) => compare(value, condition))) return false;
    }
  }
  return true;
};

const clone = <T>(value: T): T => {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof mongoose.Types.ObjectId) return value.toString() as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, clone(item)])) as T;
  return value;
};
const serialize = (document: any): Plain => document?.toObject
  ? document.toObject({ depopulate: true, flattenObjectIds: true, getters: false, virtuals: false, minimize: false })
  : clone(document);

const tenantIdFor = (entry: RegisteredModel, write = false): string | undefined => {
  if (!entry.tenantScoped || isSystemContext()) return undefined;
  const tenant = write ? requireTenantId() : currentTenantId() ?? requireTenantId();
  return tenant.toString();
};

const scopedFilter = (entry: RegisteredModel, filter: Plain): Plain => {
  if (!entry.tenantScoped || isSystemContext()) return filter;
  const tenantId = requireTenantId();
  if (filter.tenantId && !equal(filter.tenantId, tenantId)) throw new TenantContextError("Cross-tenant database access was blocked");
  filter.tenantId = tenantId;
  return filter;
};

const scopedUpdate = (entry: RegisteredModel, update: Plain, upsert = false): Plain => {
  if (!entry.tenantScoped || isSystemContext()) return update;
  const tenantId = requireTenantId();
  if (update.$unset?.tenantId !== undefined) throw new TenantContextError("A record cannot be detached from its tenant");
  if (update.$set?.tenantId && !equal(update.$set.tenantId, tenantId)) throw new TenantContextError("Cross-tenant database access was blocked");
  if (upsert) (update.$setOnInsert ??= {}).tenantId = tenantId;
  return update;
};

// Model queries may be constructed before a tenant hook runs (the tenancy
// invariant tests intentionally exercise that path). Capture immediately when
// context exists; otherwise the collection read still fails closed at execute.
const captureScopedFilter = (entry: RegisteredModel, filter: Plain): Plain =>
  !entry.tenantScoped ? filter : isSystemContext() ? { ...filter, $postgresSystem: true } : currentTenantId() ? scopedFilter(entry, filter) : filter;
const captureScopedUpdate = (entry: RegisteredModel, update: Plain, upsert = false): Plain =>
  !entry.tenantScoped || isSystemContext() || currentTenantId() ? scopedUpdate(entry, update, upsert) : update;

// Translate the index-friendly subset of a Mongo filter into SQL so PostgreSQL
// narrows rows before they are hydrated. The in-memory matcher still runs on
// every returned row, so each clause only has to select a superset of matches;
// anything not understood here is simply left to the matcher.
const isIdValue = (value: any): boolean => value instanceof mongoose.Types.ObjectId || (typeof value === "string" && value.length > 0);
const pathClause = (schema: Schema, path: string, condition: any, params: any[]): string | undefined => {
  if (path === "_id") {
    if (isIdValue(condition)) { params.push(String(condition)); return `id = $${params.length}`; }
    if (condition && typeof condition === "object" && !Array.isArray(condition) && Object.keys(condition).length === 1) {
      if (isIdValue(condition.$eq)) { params.push(String(condition.$eq)); return `id = $${params.length}`; }
      if (Array.isArray(condition.$in) && condition.$in.every(isIdValue)) { params.push(condition.$in.map(String)); return `id = ANY($${params.length}::varchar[])`; }
    }
    return undefined;
  }
  if (path.startsWith("$") || path === "tenantId" || path.includes(".")) return undefined;
  const schemaType: any = schema.path(path); if (!schemaType) return undefined;
  const isArray = schemaType.instance === "Array";
  const instance = isArray ? schemaType.caster?.instance : schemaType.instance;
  const accepts = (value: any): boolean =>
    instance === "String" ? typeof value === "string" : instance === "Boolean" ? typeof value === "boolean" : instance === "ObjectId" ? isIdValue(value) : false;
  const containment = (value: any): string => { params.push(JSON.stringify({ [path]: isArray ? [scalar(value)] : scalar(value) })); return `document @> $${params.length}::jsonb`; };
  let clause: string | undefined;
  if (accepts(condition)) clause = containment(condition);
  else if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof mongoose.Types.ObjectId) && Object.keys(condition).length === 1) {
    if (accepts(condition.$eq)) clause = containment(condition.$eq);
    else if (Array.isArray(condition.$in) && condition.$in.length > 0 && condition.$in.length <= 50 && condition.$in.every(accepts)) clause = `(${condition.$in.map(containment).join(" OR ")})`;
  }
  if (!clause) return undefined;
  // Hydration fills schema defaults for keys absent from older JSON rows, so
  // keep those rows and let the matcher decide.
  if (schemaType.defaultValue !== undefined) { params.push(path); clause = `(${clause} OR NOT (document ? $${params.length}))`; }
  return clause;
};
export const buildPostgresPrefilter = (schema: Schema, filter: Plain | undefined, params: any[]): string[] => {
  const clauses: string[] = [];
  for (const [path, condition] of Object.entries(filter ?? {})) {
    if (path === "$and" && Array.isArray(condition)) { for (const item of condition) clauses.push(...buildPostgresPrefilter(schema, item, params)); continue; }
    if (path === "$or" && Array.isArray(condition) && condition.length) {
      const snapshot = params.length; const branches = condition.map((item: Plain) => buildPostgresPrefilter(schema, item, params));
      if (branches.every((branch) => branch.length)) clauses.push(`(${branches.map((branch) => `(${branch.join(" AND ")})`).join(" OR ")})`);
      else params.length = snapshot;
      continue;
    }
    const clause = pathClause(schema, path, condition, params); if (clause) clauses.push(clause);
  }
  return clauses;
};

const readRows = async (entry: RegisteredModel, capturedTenantId?: string, filter?: Plain): Promise<Plain[]> => {
  const tenantId = capturedTenantId === SYSTEM_SCOPE ? undefined : capturedTenantId ?? tenantIdFor(entry);
  const params: any[] = []; const clauses: string[] = [];
  if (tenantId) { params.push(tenantId); clauses.push(`tenant_id = $1`); }
  clauses.push(...buildPostgresPrefilter(entry.schema, filter, params));
  const result = await postgres.query(`SELECT document FROM ${quoteIdentifier(entry.table)}${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`, params);
  // JSONB has no native ObjectId or Date types. Rehydrate through the existing
  // schema so comparisons and service code keep their original runtime types.
  return result.rows.map((row) => serialize(entry.model.hydrate(row.document)));
};

const validateTenant = (entry: RegisteredModel, data: Plain, write = true): void => {
  if (!entry.tenantScoped) return;
  const context = tenantIdFor(entry, write);
  if (context) {
    if (data.tenantId && String(data.tenantId) !== context) throw new TenantContextError("Cross-tenant database access was blocked");
    data.tenantId = context;
  } else if (!data.tenantId) throw new TenantContextError("System writes to tenant data must specify tenantId");
};

const persist = async (entry: RegisteredModel, input: any, insertOnly = false): Promise<any> => {
  const document = input instanceof entry.model ? input : new entry.model(input);
  const now = new Date();
  if (!document._id) document._id = objectId();
  if (entry.schema.options.timestamps) {
    if (!document.createdAt) document.createdAt = now;
    document.updatedAt = now;
  }
  const plain = serialize(document); validateTenant(entry, plain);
  document.set(plain);
  await document.validate();
  const stored = serialize(document);
  const sql = insertOnly
    ? `INSERT INTO ${quoteIdentifier(entry.table)} (id, tenant_id, document, created_at, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)`
    : `INSERT INTO ${quoteIdentifier(entry.table)} (id, tenant_id, document, created_at, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)
       ON CONFLICT (id) DO UPDATE SET tenant_id=excluded.tenant_id, document=excluded.document, updated_at=excluded.updated_at`;
  try {
    await postgres.query(sql, [String(stored._id), stored.tenantId ? String(stored.tenantId) : null, JSON.stringify(stored), stored.createdAt ?? now, stored.updatedAt ?? now]);
  } catch (error: any) {
    if (error?.code === "23505") { error.code = 11000; error.name = "MongoServerError"; }
    throw error;
  }
  document.isNew = false;
  return document;
};

const projectionObject = (projection?: Projection): Plain | undefined => {
  if (!projection) return undefined;
  if (typeof projection === "string") {
    const result: Plain = {};
    for (const item of projection.split(/\s+/).filter(Boolean)) result[item.replace(/^[-+]/, "")] = item.startsWith("-") ? 0 : item.startsWith("+") ? 2 : 1;
    return result;
  }
  return projection;
};
const project = (document: Plain, projection?: Projection, hidden: string[] = []): Plain => {
  const fields = projectionObject(projection);
  const includes = fields && Object.values(fields).some((value) => value === 1);
  let result = clone(document);
  if (includes && fields) {
    result = {};
    if (fields._id !== 0 && document._id !== undefined) result._id = document._id;
    for (const [path, enabled] of Object.entries(fields)) if (enabled && path !== "_id") { const value = valueAt(document, path); if (value !== undefined) setAt(result, path, value); }
  } else {
    const excluded = [...hidden.filter((path) => fields?.[path] !== 2), ...Object.entries(fields ?? {}).filter(([, enabled]) => enabled === 0).map(([path]) => path)];
    for (const path of excluded) unsetAt(result, path);
  }
  return result;
};

const sortDocuments = (documents: Plain[], sort?: Sort): Plain[] => {
  if (!sort) return documents;
  const spec: Plain = typeof sort === "string" ? Object.fromEntries(sort.split(/\s+/).filter(Boolean).map((path) => [path.replace(/^-/, ""), path.startsWith("-") ? -1 : 1])) : sort;
  return documents.sort((left, right) => {
    for (const [path, direction] of Object.entries(spec)) {
      const a = scalar(valueAt(left, path)); const b = scalar(valueAt(right, path));
      if (a == b) continue; if (a == null) return -1 * Number(direction); if (b == null) return 1 * Number(direction);
      return (a < b ? -1 : 1) * Number(direction);
    }
    return 0;
  });
};

const schemaRef = (schema: Schema, path: string): string | undefined => {
  const direct: any = schema.path(path); if (direct?.options?.ref) return direct.options.ref;
  const [head, ...tail] = path.split("."); const parent: any = schema.path(head!);
  if (tail.length && parent?.schema) return schemaRef(parent.schema, tail.join("."));
  return undefined;
};

const replacePopulatedPath = (source: any, parts: string[], candidates: Plain[]): void => {
  if (!source || !parts.length) return;
  if (Array.isArray(source)) { for (const item of source) replacePopulatedPath(item, parts, candidates); return; }
  const [head, ...tail] = parts;
  if (tail.length) { replacePopulatedPath(source[head!], tail, candidates); return; }
  const resolve = (id: any) => candidates.find((item) => equal(item._id, id)) ?? null;
  source[head!] = Array.isArray(source[head!]) ? source[head!].map(resolve).filter(Boolean) : resolve(source[head!]);
};

const populateOne = async (entry: RegisteredModel, document: Plain, request: Populate): Promise<void> => {
  const spec = typeof request === "string" ? { path: request } : request;
  for (const path of spec.path.split(/\s+/).filter(Boolean)) {
    const ref = schemaRef(entry.schema, path); if (!ref) continue;
    const target = registered.get(ref); if (!target) continue;
    const current = valueAt(document, path); if (current == null) continue;
    const ids = valuesAt(document, path).flat(Infinity);
    const tenantId = target.tenantScoped ? String(document.tenantId ?? "") : undefined;
    if (target.tenantScoped && !tenantId) throw new TenantContextError("Populated tenant data must retain tenantId");
    let candidates = (await readRows(target, tenantId, { _id: { $in: ids.filter((id) => id != null).map((id) => id?._id ?? id) } })).filter((item) => ids.some((id) => equal(item._id, id)) && matches(item, spec.match ?? {}));
    sortDocuments(candidates, spec.options?.sort); if (spec.options?.limit) candidates = candidates.slice(0, spec.options.limit);
    // Nested references need the parent tenantId before public field selection removes it.
    if (spec.populate) for (const item of candidates) for (const nested of Array.isArray(spec.populate) ? spec.populate : [spec.populate]) await populateOne(target, item, nested);
    const populated = candidates.map((item) => project(item, spec.select));
    replacePopulatedPath(document, path.split("."), populated);
  }
};

const decoratePopulatedDocument = (entry: RegisteredModel, document: Plain): Plain => {
  const value = document;
  Object.defineProperties(value, {
    id: { configurable: true, enumerable: false, get: () => String(value._id) },
    toObject: { configurable: true, enumerable: false, value: () => clone(value) },
    save: { configurable: true, enumerable: false, value: async () => {
      const populated = Object.keys(entry.schema.paths).flatMap((path) => {
        if (!schemaRef(entry.schema, path)) return [];
        const current = valueAt(value, path);
        const isPopulated = Array.isArray(current)
          ? current.some((item) => item && typeof item === "object" && "_id" in item)
          : current && typeof current === "object" && "_id" in current;
        return isPopulated ? [[path, current] as const] : [];
      });
      const saved = await persist(entry, value);
      Object.assign(value, serialize(saved));
      for (const [path, current] of populated) setAt(value, path, current);
      return value;
    } },
    populate: { configurable: true, enumerable: false, value: async (path: Populate | Populate[], select?: Projection) => {
      const requests = Array.isArray(path) ? path : [typeof path === "string" && select ? { path, select } : path];
      for (const request of requests) await populateOne(entry, value, request);
      return value;
    } },
  });
  return value;
};

const applyUpdate = (document: Plain, update: Plain, inserting = false): Plain => {
  if (Array.isArray(update)) {
    for (const stage of update) if (stage.$set) for (const [path, value] of Object.entries(stage.$set)) setAt(document, path, expression(document, value));
    return document;
  }
  const operatorUpdate = Object.keys(update).some((key) => key.startsWith("$"));
  if (!operatorUpdate) return { ...clone(update), _id: document._id, tenantId: document.tenantId };
  for (const [path, value] of Object.entries(update.$set ?? {})) setAt(document, path, value);
  for (const path of Object.keys(update.$unset ?? {})) unsetAt(document, path);
  for (const [path, value] of Object.entries(update.$inc ?? {})) setAt(document, path, Number(valueAt(document, path) ?? 0) + Number(value));
  for (const [path, value] of Object.entries(update.$max ?? {})) if (valueAt(document, path) == null || scalar(valueAt(document, path)) < scalar(value)) setAt(document, path, value);
  for (const [path, value] of Object.entries(update.$min ?? {})) if (valueAt(document, path) == null || scalar(valueAt(document, path)) > scalar(value)) setAt(document, path, value);
  for (const [path, value] of Object.entries(update.$push ?? {})) { const list = [...(valueAt(document, path) ?? [])]; const values = (value as any)?.$each ?? [value]; list.push(...values); setAt(document, path, list); }
  for (const [path, value] of Object.entries(update.$addToSet ?? {})) { const list = [...(valueAt(document, path) ?? [])]; const values = (value as any)?.$each ?? [value]; for (const item of values) if (!list.some((entry) => equal(entry, item))) list.push(item); setAt(document, path, list); }
  for (const [path, value] of Object.entries(update.$pull ?? {})) setAt(document, path, (valueAt(document, path) ?? []).filter((item: any) => !compare(item, value)));
  if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert ?? {})) if (valueAt(document, path) === undefined) setAt(document, path, value);
  return document;
};

class PostgresQuery<T = any> implements PromiseLike<T> {
  private projection?: Projection; private order?: Sort; private maximum?: number; private offset = 0; private leanResult = false; private populates: Populate[] = []; private fail = false;
  constructor(private readonly executeQuery: () => Promise<any>, private readonly entry: RegisteredModel, private rawFilter: Plain = {}, private rawUpdate?: Plain, private rawOptions: Plain = {}) {}
  getFilter(): Plain { return this.rawFilter; }
  setQuery(filter: Plain): this { this.rawFilter = filter; return this; }
  getUpdate(): Plain | undefined { return this.rawUpdate; }
  getOptions(): Plain { return this.rawOptions; }
  select(value: Projection): this { this.projection = value; return this; }
  sort(value: Sort): this { this.order = value; return this; }
  limit(value: number): this { this.maximum = value; return this; }
  skip(value: number): this { this.offset = value; return this; }
  lean<U = T>(): PostgresQuery<U> { this.leanResult = true; return this as any; }
  populate<U = T>(path: Populate | Populate[], select?: Projection): PostgresQuery<U> { this.populates.push(...(Array.isArray(path) ? path : [typeof path === "string" && select ? { path, select } : path])); return this as any; }
  async distinct(path: string): Promise<any[]> { const value = await this.executeQuery(); const items = Array.isArray(value) ? value : value == null ? [] : [value]; return [...new Map(items.flatMap((item) => valuesAt(item, path)).map((item) => castPostgresDistinctValue(this.entry.schema, path, item)).map((item) => [String(item), item])).values()]; }
  collation(): this { return this; }
  session(): this { return this; }
  setOptions(): this { return this; }
  orFail(): this { this.fail = true; return this; }
  async exec(): Promise<T> {
    const result = await this.executeQuery();
    if (result !== null && result !== undefined && (!Array.isArray(result)) && (typeof result !== "object" || "acknowledged" in result)) return result as T;
    const array = Array.isArray(result); let items = array ? result : result == null ? [] : [result];
    sortDocuments(items, this.order); items = items.slice(this.offset, this.maximum === undefined ? undefined : this.offset + this.maximum);
    for (const item of items) for (const populate of this.populates) await populateOne(this.entry, item, populate);
    const hidden = Object.entries(this.entry.schema.paths).filter(([, path]: any) => path.options?.select === false).map(([path]) => path);
    items = items.map((item) => project(item, this.projection, hidden));
    if (this.fail && !items.length) throw new Error("No document found");
    const converted = this.leanResult ? items : this.populates.length ? items.map((item) => decoratePopulatedDocument(this.entry, item)) : items.map((item) => this.entry.model.hydrate(item));
    return (array ? converted : converted[0] ?? null) as T;
  }
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> { return this.exec().then(onfulfilled, onrejected); }
  catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null) { return this.exec().catch(onrejected); }
  finally(onfinally?: (() => void) | null) { return this.exec().finally(onfinally); }
}

const aggregateDocuments = async (entry: RegisteredModel, pipeline: Plain[], initial?: Plain[], variables: Plain = {}): Promise<Plain[]> => {
  let documents = initial ?? await readRows(entry);
  for (const stage of pipeline) {
    if (stage.$match) documents = documents.filter((document) => matches(document, stage.$match, variables));
    else if (stage.$sort) sortDocuments(documents, stage.$sort);
    else if (stage.$limit) documents = documents.slice(0, stage.$limit);
    else if (stage.$unwind) { const path = String(stage.$unwind).replace(/^\$/, ""); documents = documents.flatMap((document) => (valueAt(document, path) ?? []).map((value: any) => { const copy = clone(document); setAt(copy, path, value); return copy; })); }
    else if (stage.$lookup) {
      const target = [...registered.values()].find((item) => item.table === stage.$lookup.from); if (!target) continue;
      const foreignByTenant = new Map<string, Promise<Plain[]>>();
      documents = await Promise.all(documents.map(async (document) => {
        const tenantId = target.tenantScoped ? String(document.tenantId ?? "") : undefined;
        if (target.tenantScoped && !tenantId) throw new TenantContextError("Lookup tenant data must retain tenantId");
        const cacheKey = tenantId ?? SYSTEM_SCOPE;
        if (!foreignByTenant.has(cacheKey)) foreignByTenant.set(cacheKey, readRows(target, tenantId ?? SYSTEM_SCOPE));
        // Nested pipelines sort in place, so each join gets its own array.
        const foreign = [...await foreignByTenant.get(cacheKey)!];
        const variables = Object.fromEntries(Object.entries(stage.$lookup.let ?? {}).map(([key, value]) => [key, expression(document, value)]));
        const joined = stage.$lookup.pipeline ? await aggregateDocuments(target, stage.$lookup.pipeline, foreign, variables) : foreign.filter((item) => equal(valueAt(item, stage.$lookup.foreignField), valueAt(document, stage.$lookup.localField)));
        return { ...document, [stage.$lookup.as]: joined };
      }));
    } else if (stage.$group) {
      const groups = new Map<string, Plain>();
      for (const document of documents) {
        const id = expression(document, stage.$group._id); const key = JSON.stringify(id); const group = groups.get(key) ?? { _id: id };
        for (const [field, accumulator] of Object.entries(stage.$group)) {
          if (field === "_id") continue; const spec: any = accumulator;
          if (spec.$sum !== undefined) group[field] = Number(group[field] ?? 0) + Number(expression(document, spec.$sum) ?? 0);
          if (spec.$max !== undefined) { const value = expression(document, spec.$max); if (group[field] == null || scalar(value) > scalar(group[field])) group[field] = value; }
          if (spec.$first !== undefined && group[field] === undefined) group[field] = expression(document, spec.$first);
          if (spec.$push !== undefined) (group[field] ??= []).push(expression(document, spec.$push));
        }
        groups.set(key, group);
      }
      documents = [...groups.values()];
    } else if (stage.$project) documents = documents.map((document) => {
      const result: Plain = {}; for (const [field, value] of Object.entries(stage.$project)) if (value === 1) result[field] = document[field]; else if (value !== 0) result[field] = expression(document, value); return result;
    });
  }
  return documents;
};

const collectionScopedFilter = (entry: RegisteredModel, filter: Plain): Plain => entry.tenantScoped && isSystemContext() && !filter.tenantId ? { ...filter, $postgresSystem: true } : filter;
const tenantFromFilter = (entry: RegisteredModel, filter: Plain): string | undefined => entry.tenantScoped && filter.$postgresSystem ? SYSTEM_SCOPE : entry.tenantScoped && filter.tenantId ? String(filter.tenantId) : undefined;

const collectionShim = (entry: RegisteredModel) => ({
  collectionName: entry.table,
  findOne: async (filter: Plain, options?: { projection?: Plain }) => { filter = collectionScopedFilter(entry, filter); const item = (await readRows(entry, tenantFromFilter(entry, filter), filter)).find((row) => matches(row, filter)); return item ? project(item, options?.projection) : null; },
  find: (filter: Plain = {}, options?: { projection?: Plain }) => { filter = collectionScopedFilter(entry, filter); let maximum: number | undefined; return { limit(value: number) { maximum = value; return this; }, async toArray() { let rows = (await readRows(entry, tenantFromFilter(entry, filter), filter)).filter((item) => matches(item, filter)); if (maximum) rows = rows.slice(0, maximum); return rows.map((item) => project(item, options?.projection)); } }; },
  insertOne: async (document: Plain) => { const saved = await persist(entry, document, true); return { acknowledged: true, insertedId: saved._id }; },
  updateOne: async (filter: Plain, update: Plain, options?: Plain) => updateMany(entry, filter, update, { ...options, single: true }),
  updateMany: async (filter: Plain, update: Plain, options?: Plain) => updateMany(entry, filter, update, options),
  deleteMany: async (filter: Plain) => deleteMany(entry, filter),
  deleteOne: async (filter: Plain) => { const item = (await readRows(entry, tenantFromFilter(entry, filter), filter)).find((row) => matches(row, filter)); if (!item) return { acknowledged: true, deletedCount: 0 }; await postgres.query(`DELETE FROM ${quoteIdentifier(entry.table)} WHERE id=$1`, [String(item._id)]); return { acknowledged: true, deletedCount: 1 }; },
  findOneAndUpdate: async (filter: Plain, update: Plain, options?: Plain) => findOneAndUpdate(entry, filter, update, options),
  findOneAndDelete: async (filter: Plain) => { const item = (await readRows(entry, tenantFromFilter(entry, filter), filter)).find((row) => matches(row, filter)); if (item) await postgres.query(`DELETE FROM ${quoteIdentifier(entry.table)} WHERE id=$1`, [String(item._id)]); return item ?? null; },
  countDocuments: async (filter: Plain = {}) => (await readRows(entry, tenantFromFilter(entry, filter), filter)).filter((item) => matches(item, filter)).length,
  aggregate: <T = Plain>(pipeline: Plain[]) => ({ toArray: async () => {
    const tenantId = tenantFromFilter(entry, pipeline[0]?.$match ?? {});
    const leadingMatches: Plain[] = [];
    for (const stage of pipeline) { if (!stage.$match) break; leadingMatches.push(stage.$match); }
    return aggregateDocuments(entry, pipeline, await readRows(entry, tenantId, { $and: leadingMatches })) as Promise<T[]>;
  } }),
  indexes: async () => [], dropIndex: async () => undefined, createIndex: async () => undefined,
});

const updateMany = async (entry: RegisteredModel, filter: Plain, update: Plain, options: Plain = {}) => {
  const rows = (await readRows(entry, tenantFromFilter(entry, filter), filter)).filter((item) => matches(item, filter)); const selected = options.single ? rows.slice(0, 1) : rows;
  for (const row of selected) await persist(entry, applyUpdate(row, update));
  if (!selected.length && options.upsert) { const base = Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith("$") && (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId))); await persist(entry, applyUpdate(base, update, true)); return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }; }
  return { acknowledged: true, matchedCount: selected.length, modifiedCount: selected.length, upsertedCount: 0 };
};
const deleteMany = async (entry: RegisteredModel, filter: Plain) => { const rows = (await readRows(entry, tenantFromFilter(entry, filter), filter)).filter((item) => matches(item, filter)); if (rows.length) await postgres.query(`DELETE FROM ${quoteIdentifier(entry.table)} WHERE id = ANY($1::varchar[])`, [rows.map((item) => String(item._id))]); return { acknowledged: true, deletedCount: rows.length }; };
const findOneAndUpdate = async (entry: RegisteredModel, filter: Plain, update: Plain, options: Plain = {}) => {
  const row = (await readRows(entry, tenantFromFilter(entry, filter), filter)).find((item) => matches(item, filter));
  if (!row && !options.upsert) return null;
  const base = row ?? Object.fromEntries(Object.entries(filter).filter(([key, value]) => !key.startsWith("$") && (!value || typeof value !== "object" || value instanceof Date || value instanceof mongoose.Types.ObjectId)));
  const saved = await persist(entry, applyUpdate(base, update, !row)); return options.new === false || options.returnDocument === "before" ? row : serialize(saved);
};

export const postgresModel = <T>(name: string, schema: Schema<T>, tenantScoped = false): Model<T> => {
  const compiled = (mongoose.models[name] as Model<T> | undefined) ?? mongoose.model<T>(name, schema);
  const entry: RegisteredModel = { name, table: compiled.collection.collectionName, tenantScoped, schema, model: compiled };
  registered.set(name, entry);
  const createOne = async (input: any) => {
    const document = input instanceof compiled ? input : new compiled(input); const plain = serialize(document); validateTenant(entry, plain); document.set(plain); await document.validate();
    if (!document._id) document._id = objectId();
    const timestamped = document as any; const now = new Date(); if (entry.schema.options.timestamps) { if (!timestamped.createdAt) timestamped.createdAt = now; timestamped.updatedAt = now; }
    await (compiled.collection as any).insertOne(serialize(document)); document.isNew = false; return document;
  };
  Object.assign(compiled, {
    find: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => (compiled.collection as any).find(scoped).toArray(), entry, scoped); },
    findOne: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => (compiled.collection as any).findOne(scoped), entry, scoped); },
    findById: (id: any) => { const scoped = captureScopedFilter(entry, { _id: id }); return new PostgresQuery(async () => (compiled.collection as any).findOne(scoped), entry, scoped); },
    create: async (input: any) => Array.isArray(input) ? Promise.all(input.map(createOne)) : createOne(input),
    insertMany: async (input: any[]) => Promise.all(input.map(createOne)),
    countDocuments: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => { const value = await (compiled.collection as any).countDocuments(scoped); debug(entry.name, "countDocuments", value); return value; }, entry, scoped); },
    exists: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => { const item = await (compiled.collection as any).findOne(scoped, { projection: { _id: 1 } }); debug(entry.name, "exists", Boolean(item)); return item ? { _id: item._id } : null; }, entry, scoped); },
    distinct: async (path: string, filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); const rows = await (compiled.collection as any).find(scoped).toArray(); return [...new Map(rows.flatMap((item: Plain) => valuesAt(item, path)).map((value: any) => castPostgresDistinctValue(entry.schema, path, value)).map((value: any) => [String(value), value])).values()]; },
    updateOne: (filter: Plain, update: Plain, options?: Plain) => { const scoped = captureScopedFilter(entry, filter); const change = captureScopedUpdate(entry, update, Boolean(options?.upsert)); return new PostgresQuery(async () => (compiled.collection as any).updateOne(scoped, change, options), entry, scoped, change, options); },
    updateMany: (filter: Plain, update: Plain, options?: Plain) => { const scoped = captureScopedFilter(entry, filter); const change = captureScopedUpdate(entry, update, Boolean(options?.upsert)); return new PostgresQuery(async () => (compiled.collection as any).updateMany(scoped, change, options), entry, scoped, change, options); },
    findOneAndUpdate: (filter: Plain, update: Plain, options?: Plain) => { const scoped = captureScopedFilter(entry, filter); const change = captureScopedUpdate(entry, update, Boolean(options?.upsert)); return new PostgresQuery(async () => { const value = await (compiled.collection as any).findOneAndUpdate(scoped, change, options); debug(entry.name, "findOneAndUpdate", Boolean(value)); return value; }, entry, scoped, change, options); },
    findByIdAndUpdate: (id: any, update: Plain, options?: Plain) => { const scoped = captureScopedFilter(entry, { _id: id }); const change = captureScopedUpdate(entry, update, Boolean(options?.upsert)); return new PostgresQuery(async () => (compiled.collection as any).findOneAndUpdate(scoped, change, options), entry, scoped, change, options); },
    deleteMany: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => (compiled.collection as any).deleteMany(scoped), entry, scoped); },
    deleteOne: (filter: Plain = {}) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => (compiled.collection as any).deleteOne(scoped), entry, scoped); },
    findOneAndDelete: (filter: Plain) => { const scoped = captureScopedFilter(entry, filter); return new PostgresQuery(async () => (compiled.collection as any).findOneAndDelete(scoped), entry, scoped); },
    findByIdAndDelete: (id: any) => { const scoped = captureScopedFilter(entry, { _id: id }); return new PostgresQuery(async () => (compiled.collection as any).findOneAndDelete(scoped), entry, scoped); },
    aggregate: (pipeline: Plain[] = []) => { const scopedPipeline = entry.tenantScoped && isSystemContext() ? [{ $match: { $postgresSystem: true } }, ...pipeline] : entry.tenantScoped && currentTenantId() ? [{ $match: scopedFilter(entry, {}) }, ...pipeline] : pipeline; return Object.assign(new PostgresQuery(async () => (compiled.collection as any).aggregate(scopedPipeline).toArray(), entry).lean(), { pipeline: () => scopedPipeline }); },
    bulkWrite: async (operations: Plain[]) => {
      const scopedOperations = operations.map((operation) => operation.insertOne ? operation : operation.updateOne ? { updateOne: { ...operation.updateOne, filter: scopedFilter(entry, operation.updateOne.filter), update: scopedUpdate(entry, operation.updateOne.update, Boolean(operation.updateOne.upsert)) } } : operation.updateMany ? { updateMany: { ...operation.updateMany, filter: scopedFilter(entry, operation.updateMany.filter), update: scopedUpdate(entry, operation.updateMany.update, Boolean(operation.updateMany.upsert)) } } : operation.deleteOne ? { deleteOne: { ...operation.deleteOne, filter: scopedFilter(entry, operation.deleteOne.filter) } } : operation.deleteMany ? { deleteMany: { ...operation.deleteMany, filter: scopedFilter(entry, operation.deleteMany.filter) } } : operation);
      for (const operation of scopedOperations) { if (operation.insertOne) await persist(entry, operation.insertOne.document, true); else if (operation.updateOne) await updateMany(entry, operation.updateOne.filter, operation.updateOne.update, { ...operation.updateOne, single: true }); else if (operation.updateMany) await updateMany(entry, operation.updateMany.filter, operation.updateMany.update, operation.updateMany); else if (operation.deleteOne) await deleteMany(entry, operation.deleteOne.filter); else if (operation.deleteMany) await deleteMany(entry, operation.deleteMany.filter); } return { acknowledged: true };
    },
    createIndexes: async () => undefined,
  });
  Object.defineProperty(compiled, "collection", { configurable: true, value: collectionShim(entry) });
  compiled.prototype.save = async function () {
    const now = new Date(); if (entry.schema.options.timestamps) { if (!this.createdAt) this.createdAt = now; this.updatedAt = now; }
    const plain = serialize(this); validateTenant(entry, plain); this.set(plain); await this.validate();
    if (process.env.POSTGRES_MODEL_DEBUG === "true") console.error("postgres-model-save", entry.name, { isNew: this.isNew, id: String(this._id), status: (this as any).status });
    if (this.isNew) await (compiled.collection as any).insertOne(serialize(this));
    else await (compiled.collection as any).updateOne(scopedFilter(entry, { _id: this._id }), scopedUpdate(entry, { $set: serialize(this) }));
    this.isNew = false; return this;
  };
  compiled.prototype.populate = async function (this: any, path: Populate | Populate[], select?: Projection) {
    const document = serialize(this);
    const requests = Array.isArray(path) ? path : [typeof path === "string" && select ? { path, select } : path];
    for (const request of requests) await populateOne(entry, document, request);
    return decoratePopulatedDocument(entry, document) as any;
  } as any;
  return compiled;
};

export const getPostgresModels = (): RegisteredModel[] => [...registered.values()];

export const synchronizePostgresModels = async (): Promise<void> => {
  for (const entry of registered.values()) {
    await postgres.query(`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(entry.table)} (
      id varchar(24) PRIMARY KEY,
      tenant_id varchar(24),
      document jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ${quoteIdentifier(`${entry.table}_tenant_required`)} CHECK (${entry.tenantScoped ? "tenant_id IS NOT NULL" : "true"})
    )`);
    if (entry.tenantScoped) await postgres.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${entry.table}_tenant_idx`)} ON ${quoteIdentifier(entry.table)} (tenant_id)`);
    await postgres.query(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`${entry.table}_document_gin_idx`)} ON ${quoteIdentifier(entry.table)} USING gin (document jsonb_path_ops)`);
    const createdUniqueIndexes = new Set<string>();
    for (const [path, schemaType] of Object.entries(entry.schema.paths) as [string, any][]) {
      if (!schemaType.options?.unique || path.includes(".")) continue;
      const index = `${entry.table}_${path}_unique_idx`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
      const tenant = entry.tenantScoped ? "tenant_id, " : "";
      await postgres.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(index)} ON ${quoteIdentifier(entry.table)} (${tenant}(document->>'${path.replaceAll("'", "''")}')) WHERE document->>'${path.replaceAll("'", "''")}' IS NOT NULL`);
      createdUniqueIndexes.add(index);
    }
    for (const [fields, options] of entry.schema.indexes() as [Record<string, unknown>, Record<string, any>][]) {
      if (!options.unique) continue;
      const paths = Object.keys(fields).filter((path) => path !== "tenantId");
      if (!paths.length) continue;
      const index = `${entry.table}_${paths.join("_")}_unique_idx`.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 60);
      if (createdUniqueIndexes.has(index)) continue;
      const columns = [...(Object.hasOwn(fields, "tenantId") || entry.tenantScoped ? ["tenant_id"] : []), ...paths.map((path) => `(document#>>'{${path.split(".").join(",")}}')`)];
      const where = paths.map((path) => `document#>>'{${path.split(".").join(",")}}' IS NOT NULL`).join(" AND ");
      await postgres.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(index)} ON ${quoteIdentifier(entry.table)} (${columns.join(", ")}) WHERE ${where}`);
    }
  }
};

// PostgreSQL has no TTL indexes; emulate Mongo's expireAfterSeconds cleanup.
export const purgeExpiredPostgresDocuments = async (): Promise<void> => {
  for (const entry of registered.values()) {
    for (const [fields, options] of entry.schema.indexes() as [Record<string, unknown>, Record<string, any>][]) {
      if (options.expireAfterSeconds === undefined) continue;
      const path = Object.keys(fields)[0]; if (!path || path.includes(".")) continue;
      await postgres.query(
        `DELETE FROM ${quoteIdentifier(entry.table)} WHERE document ? $1 AND (document->>$1)::timestamptz < now() - make_interval(secs => $2)`,
        [path, Number(options.expireAfterSeconds)],
      );
    }
  }
};
