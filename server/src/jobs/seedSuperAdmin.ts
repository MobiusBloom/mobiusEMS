import bcrypt from "bcrypt";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, SECTION_PERMISSIONS, type CapabilityName } from "@mobius-ems/shared";
import { env } from "../config/env.js";
import { Permission } from "../models/Permission.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Department } from "../models/Department.js";
import { Team } from "../models/Team.js";
import { Designation } from "../models/Designation.js";
import { GeoNode } from "../models/GeoNode.js";
import { additionalDesignationPresets } from "../data/additionalRoleSkillCatalog.js";
import { runWithTenant } from "../tenancy/tenantContext.js";

export const seedPermissions = async (): Promise<void> => {
  await Permission.bulkWrite(PERMISSIONS.map((key) => ({ updateOne: { filter: { key }, update: { $set: { description: key.replace(".", " ") } }, upsert: true } })), { timestamps: false });
};

export const seedTenantRoles = async (): Promise<void> => {
  for (const name of ROLES) {
    const existing = await Role.findOne({ name });
    if (!existing) {
      await Role.create({ name, description: name.replaceAll("_", " "), permissions: [...ROLE_PERMISSIONS[name]], isSystem: true, eodPermissionsInitialized: true });
      continue;
    }
    existing.description = name.replaceAll("_", " ");
    existing.isSystem = true;
    if (name === "SUPER_ADMIN") existing.permissions = [...PERMISSIONS];
    else if (!existing.permissions.some((permission) => SECTION_PERMISSIONS.includes(permission as never))) {
      const defaultSections = ROLE_PERMISSIONS[name].filter((permission) => SECTION_PERMISSIONS.includes(permission as never) && permission !== "section.eod");
      existing.permissions = [...new Set([...existing.permissions, ...defaultSections])];
    }
    // Roll out EOD once to legacy built-in roles; preserve configured EOD access.
    if (!existing.eodPermissionsInitialized) {
      if (!existing.permissions.some((permission) => permission === "section.eod" || permission.startsWith("eod."))) {
        const eodPermissions = ROLE_PERMISSIONS[name].filter((permission) => permission === "section.eod" || permission.startsWith("eod."));
        existing.permissions = [...new Set([...existing.permissions, ...eodPermissions])];
      }
      existing.eodPermissionsInitialized = true;
    }
    await existing.save();
  }
};

export const seedTenantGeography = async (): Promise<void> => {
  await GeoNode.findOneAndUpdate(
    { type: "GLOBAL" },
    { $set: { isActive: true }, $unset: { location: "" }, $setOnInsert: { name: "World", code: "WORLD", ancestors: [], depth: 0 } },
    { upsert: true, new: true, runValidators: true, timestamps: false },
  );
};

export const seedTenantOrganizationPresets = async (): Promise<void> => {
  const departmentPresets: { name: string; code: string; capabilities?: CapabilityName[] }[] = [
    { name: "IT", code: "IT" },
    { name: "Sales", code: "SALE", capabilities: ["SALES_MODULE"] },
    { name: "Marketing", code: "MARK" },
    { name: "HR", code: "HR" },
    { name: "Operations", code: "OPER" },
    { name: "Administration", code: "ADMIN" },
  ];
  await Department.bulkWrite(departmentPresets.map((preset) => {
    const { capabilities, ...insertData } = preset;
    return {
      updateOne: {
        filter: { code: preset.code },
        update: {
          $setOnInsert: { ...insertData, description: `${preset.name} department`, isActive: true },
          ...(capabilities ? { $addToSet: { capabilities: { $each: capabilities } } } : {}),
        },
        upsert: true,
      },
    };
  }), { timestamps: false });
  const departmentRecords = await Department.find({ code: { $in: departmentPresets.map((preset) => preset.code) } });
  const departments = new Map(departmentRecords.map((department) => [department.name, department]));
  await Team.findOneAndUpdate(
    { department: departments.get("IT")!._id, code: "DEV" },
    { $setOnInsert: { name: "Development", description: "Software development team", isActive: true } },
    { upsert: true, new: true, runValidators: true, timestamps: false },
  );
  const designationPresets = [
    { name: "Software Engineer", code: "SWE", department: "IT", catalogRole: "AI/ML Developer" },
    { name: "Senior Engineer", code: "SSE", department: "IT", catalogRole: "AI/ML Developer" },
    { name: "AI/ML Engineer", code: "AIML", department: "IT", catalogRole: "AI/ML Developer" },
    { name: "Data Scientist", code: "DS", department: "IT", catalogRole: "Data Analyst" },
    { name: "Sales Executive", code: "SALES", department: "Sales", catalogRole: "SaaS Sales (AE)" },
    { name: "Marketing Specialist", code: "MKT", department: "Marketing", catalogRole: "SaaS Sales (AE)" },
    { name: "HR Executive", code: "HRE", department: "HR", catalogRole: "HR" },
    { name: "Operations Analyst", code: "OPS", department: "Operations", catalogRole: "Admin" },
    ...additionalDesignationPresets,
  ];
  await Designation.bulkWrite(designationPresets.map((preset) => ({ updateOne: {
    filter: { code: preset.code },
    update: { $setOnInsert: { name: preset.name, department: departments.get(preset.department)!._id, catalogRole: preset.catalogRole, isActive: true } },
    upsert: true,
  } })), { timestamps: false });
};

export const seedOrganization = async (tenantId: string): Promise<void> => {
  console.log("Verifying global permissions");
  await seedPermissions();
  await runWithTenant(tenantId, async () => {
    console.log("Verifying tenant roles");
    await seedTenantRoles();
    console.log("Verifying organization presets");
    await seedTenantOrganizationPresets();
    console.log("Verifying geographic master root");
    await seedTenantGeography();
    if (!env.SUPER_ADMIN_NAME || !env.SUPER_ADMIN_EMAIL || !env.SUPER_ADMIN_PASSWORD) {
      console.warn("Super Admin seed credentials are not configured; existing accounts remain unchanged");
      return;
    }
    const normalizedEmail = env.SUPER_ADMIN_EMAIL.toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail }).select("_id").lean();
    if (existing) {
      console.log("Existing Super Admin account and password preserved");
      return;
    }
    const role = await Role.findOne({ name: "SUPER_ADMIN" }).orFail();
    await User.create({ name: env.SUPER_ADMIN_NAME, email: normalizedEmail, passwordHash: await bcrypt.hash(env.SUPER_ADMIN_PASSWORD, 12), role: role._id, isActive: true, forcePasswordChange: false, onboardingComplete: true });
    console.log("Super Admin created");
  });
  console.log("Organization presets seeded");
};

