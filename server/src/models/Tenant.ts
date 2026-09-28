import { Schema, type Types } from "mongoose";
import { postgresModel } from "../persistence/postgresModel.js";
import {
  PLAN_TIERS,
  SUBSCRIPTION_STATUSES,
  BILLING_CYCLES,
  DEFAULT_PLAN_CONFIGS,
  type PlanTier,
  type SubscriptionStatus,
  type BillingCycle,
  type PlanFeatures,
} from "@mobius-ems/shared";

export const TENANT_STATUSES = ["PROVISIONING", "ACTIVE", "SUSPENDED"] as const;
export type TenantStatus = typeof TENANT_STATUSES[number];

export { PLAN_TIERS, SUBSCRIPTION_STATUSES, BILLING_CYCLES, type PlanTier, type SubscriptionStatus, type BillingCycle, type PlanFeatures };

export interface TenantDocument {
  name: string;
  slug: string;
  industry?: string;
  companySize?: string;
  country?: string;
  website?: string;
  referralSource?: string;
  primaryUseCase?: string;
  status: TenantStatus;
  plan: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  billingCycle: BillingCycle;
  maxEmployees: number; // 0 = unlimited
  maxStorageMb: number; // 0 = unlimited
  trialEndsAt?: Date;
  subscriptionEndsAt?: Date;
  features: PlanFeatures;
  createdBy?: Types.ObjectId;
  activatedAt?: Date;
  emailSendingProvider?: "BREVO" | "GMAIL" | "NONE";
  emailAutomation?: {
    provider: "BREVO";
    apiKeyEncrypted: string;
    senderName: string;
    senderEmail: string;
    replyToEmail: string;
    updatedAt: Date;
    updatedBy: Types.ObjectId;
  };
}

const defaultFeatures = DEFAULT_PLAN_CONFIGS.STANDARD.features;

const schema = new Schema<TenantDocument>({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true, match: /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/ },
  industry: { type: String, trim: true, maxlength: 80 },
  companySize: { type: String, enum: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] },
  country: { type: String, trim: true, maxlength: 80 },
  website: { type: String, trim: true, maxlength: 200 },
  referralSource: { type: String, trim: true, maxlength: 80 },
  primaryUseCase: { type: String, trim: true, maxlength: 120 },
  status: { type: String, enum: TENANT_STATUSES, default: "PROVISIONING", index: true },
  plan: { type: String, enum: PLAN_TIERS, default: "STANDARD", index: true },
  subscriptionStatus: { type: String, enum: SUBSCRIPTION_STATUSES, default: "ACTIVE", index: true },
  billingCycle: { type: String, enum: BILLING_CYCLES, default: "MONTHLY" },
  maxEmployees: { type: Number, default: 50 },
  maxStorageMb: { type: Number, default: 10240 },
  trialEndsAt: Date,
  subscriptionEndsAt: Date,
  features: {
    aiEnabled: { type: Boolean, default: defaultFeatures.aiEnabled },
    salesModuleEnabled: { type: Boolean, default: defaultFeatures.salesModuleEnabled },
    emailAutomationEnabled: { type: Boolean, default: defaultFeatures.emailAutomationEnabled },
    voiceTasksEnabled: { type: Boolean, default: defaultFeatures.voiceTasksEnabled },
    advancedAnalyticsEnabled: { type: Boolean, default: defaultFeatures.advancedAnalyticsEnabled },
    customRolesEnabled: { type: Boolean, default: defaultFeatures.customRolesEnabled },
  },
  createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  activatedAt: Date,
  emailSendingProvider: { type: String, enum: ["BREVO", "GMAIL", "NONE"] },
  emailAutomation: {
    provider: { type: String, enum: ["BREVO"] },
    apiKeyEncrypted: { type: String, select: false },
    senderName: { type: String, trim: true, minlength: 1, maxlength: 100 },
    senderEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    replyToEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    updatedAt: Date,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
}, { timestamps: true });

schema.index({ status: 1, subscriptionStatus: 1, createdAt: -1 });
export const Tenant = postgresModel<TenantDocument>("Tenant", schema);

