/** A concrete project-impact preview precedes every workflow publication. */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { WorkflowStep } from '@/features/projects/types';
import {
  previewWorkflowPublish,
  publishWorkflowTemplate,
  type WorkflowPublishPreview,
  type WorkflowPublishResult,
} from './workflow-publish-client';

export function WorkflowPublishImpact({
  preview,
  migratedIds,
  onMigrationChange,
  disabled = false,
}: {
  preview: WorkflowPublishPreview;
  migratedIds: string[];
  onMigrationChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Template Revision {preview.revision} → {preview.nextRevision} ·{' '}
        {preview.projects.length} projects in preview
      </p>
      {!preview.projects.length && (
        <p className="text-xs text-muted-foreground">
          No ongoing projects need synchronization. New projects will use the
          published template.
        </p>
      )}
      {preview.projects.map((project) => (
        <article key={project.projectId} className="rounded-lg border p-3">
          <p className="text-sm font-semibold">{project.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {project.changed
              ? 'Template changes will be applied'
              : 'Current records will be retained'}
          </p>
          {!!project.changes.length && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {project.changes.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          )}
          {!!project.retained.length && (
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {project.retained.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          )}
          {!!project.blockers.length && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <p className="font-medium">Resolve Before Publishing</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {project.blockers.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </div>
          )}
          {!project.completed && (
            <label className="mt-3 flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                aria-label={`Recalculate SLA for active steps in ${project.name}`}
                checked={migratedIds.includes(project.projectId)}
                disabled={disabled}
                onChange={(event) =>
                  onMigrationChange(
                    event.target.checked
                      ? [...migratedIds, project.projectId]
                      : migratedIds.filter((id) => id !== project.projectId),
                  )
                }
              />
              <span>
                Apply the new rules and recalculate SLA for active steps
                <span className="mt-1 block text-muted-foreground">
                  Selecting this refreshes the impact preview. Leave unchecked
                  to retain the original deadlines for active steps.
                </span>
              </span>
            </label>
          )}
        </article>
      ))}
    </div>
  );
}

export function WorkflowPublishDialog({
  steps,
  expectedRevision,
  onClose,
  onPublished,
}: {
  steps: WorkflowStep[];
  expectedRevision: number;
  onClose: () => void;
  onPublished: (result: WorkflowPublishResult) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<WorkflowPublishPreview | null>(null);
  const [migratedIds, setMigratedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void previewWorkflowPublish({ steps, expectedRevision })
      .then((result) => {
        if (!cancelled) {
          setPreview(result);
          setBusy(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load the preview.',
          );
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [steps, expectedRevision]);
  const reload = async (ids: string[]) => {
    setBusy(true);
    setError('');
    try {
      const result = await previewWorkflowPublish({
        steps,
        expectedRevision,
        migrateActiveProjectIds: ids,
      });
      setPreview(result);
      setMigratedIds(ids);
    } catch (cause) {
      setPreview(null);
      setError(
        cause instanceof Error ? cause.message : 'Unable to load the preview.',
      );
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (
      !preview ||
      busy ||
      publishing ||
      preview.projects.some((project) => project.blockers.length)
    )
      return;
    setPublishing(true);
    setError('');
    try {
      const result = await publishWorkflowTemplate(
        { steps, expectedRevision, migrateActiveProjectIds: migratedIds },
        Object.fromEntries(
          preview.projects
            .filter((project) => !project.completed)
            .map((project) => [project.projectId, project.revision]),
        ),
      );
      await onPublished(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to publish the template.',
      );
    } finally {
      setPublishing(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !publishing) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"
        showCloseButton={!publishing}
      >
        <DialogHeader>
          <DialogTitle>Publish Workflow · Project Impact</DialogTitle>
          <DialogDescription>
            Pending steps receive the new rules. Completed records are retained.
            Recalculating deadlines for active steps requires an explicit
            selection.
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <p className="text-sm text-muted-foreground">
            Checking template and project revisions…
          </p>
        )}
        {preview && (
          <WorkflowPublishImpact
            preview={preview}
            migratedIds={migratedIds}
            onMigrationChange={(ids) => void reload(ids)}
            disabled={busy || publishing}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={publishing}
            onClick={onClose}
          >
            Back to Editing
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || publishing}
            onClick={() => void reload(migratedIds)}
          >
            Refresh Preview
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              publishing ||
              !preview ||
              preview.projects.some((project) => project.blockers.length > 0)
            }
            onClick={() => void publish()}
          >
            {publishing ? 'Publishing…' : 'Publish and Sync Projects'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
