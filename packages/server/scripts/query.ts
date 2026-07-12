import { db } from '../src/db';
async function main() {
  const machines = await db.selectFrom('master.machine').selectAll().execute();
  const processes = await db.selectFrom('master.process').selectAll().execute();
  console.log('MACHINES:', machines);
  console.log('PROCESSES:', processes);
  process.exit(0);
}
main();
