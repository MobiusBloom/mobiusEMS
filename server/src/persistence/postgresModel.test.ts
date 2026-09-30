import assert from "node:assert/strict";
import test from "node:test";
import { Schema, Types } from "mongoose";
import { buildPostgresPrefilter, castPostgresDistinctValue } from "./postgresModel.js";

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
