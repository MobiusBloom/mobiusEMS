import assert from "node:assert/strict";
import test from "node:test";
import { Schema, Types } from "mongoose";
import { castPostgresDistinctValue } from "./postgresModel.js";

test("PostgreSQL distinct values preserve Mongoose ObjectId behavior", () => {
  const schema = new Schema({ owner: Schema.Types.ObjectId, members: [Schema.Types.ObjectId], label: String });
  const id = new Types.ObjectId().toString();

  assert.ok(castPostgresDistinctValue(schema, "_id", id) instanceof Types.ObjectId);
  assert.ok(castPostgresDistinctValue(schema, "owner", id) instanceof Types.ObjectId);
  assert.ok(castPostgresDistinctValue(schema, "members", id) instanceof Types.ObjectId);
  assert.equal(castPostgresDistinctValue(schema, "label", "Engineering"), "Engineering");
});
