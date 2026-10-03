import { Employee } from "../models/Employee.js";

// Capture the authenticated creator, independently of the employee assigned the lead.
export const leadAttributionForUser = async (userId: string) => {
  const employee = await Employee.findOne({ user: userId, isActive: true }).select("_id").lean();
  return { createdBy: userId, createdByEmployee: employee?._id };
};
