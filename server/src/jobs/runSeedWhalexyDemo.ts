import { connectDatabase, disconnectDatabase } from "../config/database.js";
import { seedWhalexyDemo } from "./seedWhalexyDemo.js";

const validateOnly = process.argv.includes("--validate");
try {
  if (!validateOnly) await connectDatabase();
  console.log(JSON.stringify(await seedWhalexyDemo(validateOnly), null, 2));
} catch (error) {
  console.error("Whalexy demo seed failed", error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
