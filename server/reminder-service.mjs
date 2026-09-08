/** Durable local reminder inbox. Scans never mutate a project workspace revision. */
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  buildDailyDigest,
  normalizeDigestDate,
} from '../features/agent/digest-domain.ts';
export function openReminderService(databasePath, repository) {
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(
    `CREATE TABLE IF NOT EXISTS local_reminders (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload_json TEXT NOT NULL, active INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, first_seen TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  );
  const list = () =>
    db
      .prepare(
        'SELECT * FROM local_reminders ORDER BY active DESC, updated_at DESC',
      )
      .all()
      .map((r) => ({
        id: r.id,
        fingerprint: r.fingerprint,
        item: JSON.parse(r.payload_json),
        active: Boolean(r.active),
        acknowledged: Boolean(r.acknowledged),
        firstSeen: r.first_seen,
        updatedAt: r.updated_at,
      }));
  return {
    scan(asOf, at) {
      const scanNow = at || (asOf ? undefined : new Date().toISOString());
      const date = normalizeDigestDate(
          asOf,
          scanNow ? new Date(scanNow) : new Date(),
        ),
        projects = repository.list(date);
      const digest = buildDailyDigest(
        projects,
        projects.flatMap((p) => p.reviewGates || []),
        date,
        scanNow,
      );
      const now = new Date().toISOString(),
        activeIds = new Set(digest.items.map((i) => i.id));
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of digest.items) {
          // Timing prose may include elapsed days. Stable SSR fingerprint comes from source state.
          const project = projects.find((p) => p.projectId === item.projectId);
          const task = item.workflowNodeId
            ? project?.workflowSteps?.find(
                (step) => step.code === item.workflowNodeId,
              )
            : undefined;
          const workflowSource =
            project?.workflowEngineVersion === 1 && task
              ? {
                  version: item.workflowVersion,
                  node: task.code,
                  state: task.state,
                  startedAt: task.startedAt,
                  dueAt: task.dueAt,
                  pausedAt: task.pausedAt,
                  followUpDate: task.followUpDate,
                  owner: task.owner,
                  note: task.note,
                  fields: task.fieldValues,
                  name: task.name,
                  nameZh: task.nameZh,
                  reminderEnabled: task.reminderEnabled,
                  urgency: item.urgency,
                }
              : project?.workflowMode === 'project'
                ? {
                    workflowMode: project.workflowMode,
                    version: project.workflowVersion || project.activeVersion,
                    stage: project.currentWorkflowStepCode,
                    step: project.workflowSteps?.find(
                      (step) => step.code === project.currentWorkflowStepCode,
                    ),
                    category: item.category,
                    severity: item.severity,
                  }
                : undefined;
          const source = project?.ssrAttention?.find(
            (i) => i.id === item.reviewId,
          );
          const review = projects
            .flatMap((p) => p.reviewGates || [])
            .find(
              (r) => r.projectId === item.projectId && r.id === item.reviewId,
            );
          const fingerprint = createHash('sha256')
            .update(
              workflowSource
                ? JSON.stringify(workflowSource)
                : source
                  ? source.fingerprint
                  : JSON.stringify(
                      review
                        ? {
                            review,
                            category: item.category,
                            severity: item.severity,
                            title: item.title,
                          }
                        : item,
                    ),
            )
            .digest('hex');
          const old = db
            .prepare('SELECT * FROM local_reminders WHERE id=?')
            .get(item.id);
          if (!old)
            db.prepare(
              'INSERT INTO local_reminders (id,fingerprint,payload_json,active,first_seen,updated_at) VALUES (?,?,?,1,?,?)',
            ).run(item.id, fingerprint, JSON.stringify(item), now, now);
          else if (old.fingerprint !== fingerprint || !old.active)
            db.prepare(
              'UPDATE local_reminders SET fingerprint=?,payload_json=?,active=1,acknowledged=0,updated_at=? WHERE id=?',
            ).run(fingerprint, JSON.stringify(item), now, item.id);
          else
            db.prepare(
              'UPDATE local_reminders SET payload_json=? WHERE id=?',
            ).run(JSON.stringify(item), item.id);
        }
        for (const old of db
          .prepare('SELECT id FROM local_reminders WHERE active=1')
          .all())
          if (!activeIds.has(old.id))
            db.prepare(
              'UPDATE local_reminders SET active=0,updated_at=? WHERE id=?',
            ).run(now, old.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { asOf: date, items: list() };
    },
    list,
    acknowledge(id, fingerprint) {
      const changed = db
        .prepare(
          'UPDATE local_reminders SET acknowledged=1 WHERE id=? AND fingerprint=? AND active=1',
        )
        .run(id, fingerprint);
      if (!changed.changes)
        throw new TypeError(
          'Reminder changed or no longer active; refresh first',
        );
      return list();
    },
    close() {
      db.close();
    },
  };
}
