import { migrateSqlite } from "../src/lib/migrate-sqlite";
import { closeDatabase } from "../src/lib/database";

const args = process.argv.slice(2);
const file =
  args.find((arg) => !arg.startsWith("--")) ||
  process.env.RING_DB_PATH ||
  ".data/ring.sqlite";
void migrateSqlite(file, args.includes("--apply"))
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (!result.applied)
      console.log(
        "Preview only. Stop all Ring processes, then pass --apply to copy into an empty destination.",
      );
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
