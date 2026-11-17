/** Read the installation state directly from a D1 binding. */
export async function readD1SetupState(database) {
  let row;
  try {
    row = await database
      .prepare(
        `select
      exists (select 1 from "user" where role = 'admin') as has_admin,
      exists (select 1 from "user") as has_users,
      (select setup_completed_at from app_settings where id = 1) as setup_completed_at`,
      )
      .first();
  } catch (error) {
    if (
      error instanceof Error &&
      /\bno such table: (?:main\.)?(?:user|app_settings)\b/i.test(error.message)
    ) {
      return { status: "unmigrated" };
    }
    throw error;
  }
  if (!row) return { status: "unmigrated" };
  if (row.has_admin) return { status: "complete" };
  if (!row.has_users && row.setup_completed_at === null)
    return { status: "fresh" };
  return { status: "unclaimed" };
}
