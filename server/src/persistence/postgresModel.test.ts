import assert from "node:assert/strict";
import test from "node:test";
import { Schema, Types } from "mongoose";
import { buildPostgresPrefilter, castPostgresDistinctValue, postgresModel } from "./postgresModel.js";
import { postgres } from "./postgres.js";
import { runWithTenant } from "../tenancy/tenantContext.js";

test("nested tenant-scoped population retains scope before applying selected fields", async (context) => {
  const tenantId = new Types.ObjectId();
  const departmentId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const documentId = new Types.ObjectId();
  const Department = postgresModel("NestedPopulateDepartment", new Schema({ tenantId: Schema.Types.ObjectId, name: String }), true);
  const Employee = postgresModel("NestedPopulateEmployee", new Schema({ tenantId: Schema.Types.ObjectId, department: { type: Schema.Types.ObjectId, ref: Department.modelName } }), true);
  const Document = postgresModel("NestedPopulateDocument", new Schema({ tenantId: Schema.Types.ObjectId, employee: { type: Schema.Types.ObjectId, ref: Employee.modelName } }), true);
  context.mock.method(postgres, "query", async (sql: string, params: unknown[]) => {
    assert.equal(params[0], tenantId.toString());
    const fields = sql.includes('"nestedpopulatedepartments"') ? { _id: departmentId.toString(), name: "Sales" } : sql.includes('"nestedpopulateemployees"') ? { _id: employeeId.toString(), department: departmentId.toString() } : { _id: documentId.toString(), employee: employeeId.toString() };
    return { rows: [{ document: { ...fields, tenantId: tenantId.toString() } }] };
  });
  const rows = await runWithTenant(tenantId, () => Document.find().populate({ path: "employee", select: "department", populate: { path: "department", select: "name" } }).lean<{ employee: { department: { name: string }; tenantId?: unknown } }[]>());
  assert.equal(rows[0]!.employee.department.name, "Sales");
  assert.equal(rows[0]!.employee.tenantId, undefined);
});

test("PostgreSQL populate supports arrays and empty arrays like Mongoose", async (context) => {
  const ownerId = new Types.ObjectId();
  const recordId = new Types.ObjectId();
  const date = "2026-09-30T09:00:00.000Z";
  const Owner = postgresModel("PopulateArrayOwner", new Schema({ name: String, joinedAt: Date }));
  const Record = postgresModel("PopulateArrayRecord", new Schema({ owner: { type: Schema.Types.ObjectId, ref: Owner.modelName }, firstResponseAt: Date, nested: { reviewedAt: Date } }));
  context.mock.method(postgres, "query", async (sql: string) => ({ rows: [{ document: sql.includes('"populatearrayowners"') ? { _id: ownerId.toString(), name: "Whalexy owner", joinedAt: date } : { _id: recordId.toString(), owner: ownerId.toString(), firstResponseAt: date, nested: { reviewedAt: date } } }] }));
  const untouched = await Record.find().populate([]).lean();
  assert.equal(String(untouched[0]!.owner), ownerId.toString());
  assert.equal(untouched[0]!.firstResponseAt!.getTime(), new Date(date).getTime());
  assert.equal(untouched[0]!.nested!.reviewedAt!.getTime(), new Date(date).getTime());
  const populated = await Record.find().populate([{ path: "owner", select: "name joinedAt" }]).lean<{ owner: { name: string; joinedAt: Date } }[]>();
  assert.equal(populated[0]!.owner.name, "Whalexy owner");
  assert.equal(populated[0]!.owner.joinedAt.getTime(), new Date(date).getTime());
});

test("PostgreSQL distinct values preserve Mongoose ObjectId behavior", () => {
  const schema = new Schema({ owner: Schema.Types.ObjectId, members: [Schema.Types.ObjectId], label: String });
  const id = new Types.ObjectId().toString();

  assert.ok(castPostgresDistinctValue(schema, "_id", id) instanceof Types.ObjectId);
  assert.ok(castPostgresDistinctValue(schema, "owner", id) instanceof Types.ObjectId);
  assert.ok(castPostgresDistinctValue(schema, "members", id) instanceof Types.ObjectId);
  assert.equal(castPostgresDistinctValue(schema, "label", "Engineering"), "Engineering");
});

test("PostgreSQL prefilter pushes indexable equality into SQL", () => {
  const schema = new Schema({ email: String, owner: Schema.Types.ObjectId, tags: [String], isActive: { type: Boolean, default: true }, joinedAt: Date });
  const id = new Types.ObjectId();
  const params: unknown[] = [];
  const clauses = buildPostgresPrefilter(schema, { _id: id, email: "a@b.co", tags: "x", tenantId: id, joinedAt: new Date(), $postgresSystem: true }, params);
  assert.deepEqual(clauses, ["id = $1", "document @> $2::jsonb", "(document @> $3::jsonb OR NOT (document ? $4))"]);
  assert.deepEqual(params, [id.toString(), JSON.stringify({ email: "a@b.co" }), JSON.stringify({ tags: ["x"] }), "tags"]);
});

test("PostgreSQL prefilter keeps rows missing a defaulted key and skips unsupported operators", () => {
  const schema = new Schema({ name: String, isActive: { type: Boolean, default: true } });
  const params: unknown[] = [];
  const clauses = buildPostgresPrefilter(schema, { isActive: true, name: /x/, "nested.path": "y", $or: [{ name: "a" }, { name: { $regex: "b" } }] }, params);
  assert.deepEqual(clauses, ["(document @> $1::jsonb OR NOT (document ? $2))"]);
  assert.deepEqual(params, [JSON.stringify({ isActive: true }), "isActive"]);
});

test("PostgreSQL prefilter translates $in and fully-indexable $or", () => {
  const schema = new Schema({ status: String });
  const ids = [new Types.ObjectId(), new Types.ObjectId()];
  const params: unknown[] = [];
  const clauses = buildPostgresPrefilter(schema, { _id: { $in: ids }, $or: [{ status: "A" }, { status: { $in: ["B", "C"] } }] }, params);
  assert.deepEqual(clauses, ["id = ANY($1::varchar[])", "((document @> $2::jsonb) OR ((document @> $3::jsonb OR document @> $4::jsonb)))"]);
  assert.deepEqual(params[0], ids.map(String));
});
