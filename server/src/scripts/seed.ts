// npm run seed: rebuild the template agency for today (Denver).
import { connectToDatabase, disconnectFromDatabase } from "../loaders/database";
import { seedTemplate } from "../services/demo/sandbox.service";

async function main() {
  await connectToDatabase();
  await seedTemplate();
  await disconnectFromDatabase();
  console.log("Template agency created.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
