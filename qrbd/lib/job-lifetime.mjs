export const PENDING_FILE_TTL = 60 * 60 * 1000;
export const ACTIVE_FILE_TTL = 24 * 60 * 60 * 1000;
export function fileExpired(job, now = Date.now()) {
  return (
    now - job.created >=
    (job.status === "pending" ? PENDING_FILE_TTL : ACTIVE_FILE_TTL)
  );
}
