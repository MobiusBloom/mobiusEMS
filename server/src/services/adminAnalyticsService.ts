import { Employee } from "../models/Employee.js";
import { Task } from "../models/Task.js";
import { summarizeTasks } from "./adminAnalyticsMath.js";

export const adminAnalytics = async () => {
  const now = new Date();
  const employees = await Employee.find({ isActive: true }).select("firstName lastName employeeId status").sort({ firstName: 1, _id: 1 }).lean();
  const tasks = await Task.find({ isActive: true, assignedEmployee: { $in: employees.map((employee) => employee._id) }, status: { $ne: "CANCELLED" } }).select("name taskId assignedEmployee status deadline completionDate estimatedHours actualHours isActive").sort({ deadline: 1, _id: 1 }).lean();
  const people = employees.map((employee) => ({ id: employee._id.toString(), name: `${employee.firstName} ${employee.lastName}`, employeeId: employee.employeeId, status: employee.status, ...summarizeTasks(tasks.filter((task) => String(task.assignedEmployee) === String(employee._id)), now) }));
  const names = new Map(people.map((person) => [person.id, person.name]));
  return { generatedAt: now.toISOString(), employeeCount: employees.length, activeCount: employees.filter((employee) => employee.status === "ACTIVE").length,
    ...summarizeTasks(tasks, now), people,
    attention: tasks.filter((task) => task.status !== "COMPLETED" && (task.deadline < now || ["BLOCKED", "IN_REVIEW"].includes(task.status))).slice(0, 12).map((task) => ({ id: task._id.toString(), name: task.name, employee: names.get(task.assignedEmployee.toString()), status: task.status, deadline: task.deadline, overdue: task.deadline < now })) };
};
