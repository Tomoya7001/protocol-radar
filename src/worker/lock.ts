import type { Db } from "../lib/db/connection";

/**
 * Single-row advisory lock (worker_lock, id=1). acquireLock atomically flips locked 0->1
 * and returns true only for the winner; a concurrent runOnce sees locked=1 and backs off.
 * This prevents overlapping runs from double-polling the same due sources.
 */
export function acquireLock(db: Db, now: string): boolean {
  const info = db
    .prepare(
      `UPDATE worker_lock SET locked = 1, locked_at = ?
         WHERE id = 1 AND locked = 0`,
    )
    .run(now);
  return info.changes === 1;
}

export function releaseLock(db: Db): void {
  db.prepare(
    "UPDATE worker_lock SET locked = 0, locked_at = NULL WHERE id = 1",
  ).run();
}

export function isLocked(db: Db): boolean {
  const row = db
    .prepare("SELECT locked FROM worker_lock WHERE id = 1")
    .get() as { locked: number } | undefined;
  return row?.locked === 1;
}
