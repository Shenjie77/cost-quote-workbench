import { Text, Surface } from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
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

/** Explain inherited progress, retained history and optional active-SLA changes before publication. */
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
      <Text as="p" textRole="body-main">
        Template Revision {preview.revision} → {preview.nextRevision} ·{' '}
        {preview.projects.length} projects in preview
      </Text>
      <Text as="p" tone="muted" textRole="body-small">
        New steps in phases a project has already passed are automatically
        passed with a skip record. Steps in current or future phases remain
        pending. Completed projects retain their recorded workflow.
      </Text>
      {!preview.projects.length && (
        <Text as="p" tone="muted" textRole="body-small">
          No ongoing projects need synchronization. New projects will use the
          published template.
        </Text>
      )}
      {preview.projects.map((project) => (
        <Surface key={project.projectId} as="article" variant="panel" padded>
          <Text as="p" textRole="body-main">
            {project.name}
          </Text>
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {project.changed
              ? 'Template changes will be applied'
              : 'Current records will be retained'}
          </Text>
          {!!project.changes.length && (
            <Surface
              as="ul"
              variant="body"
              textRole="body-small"
              className="mt-2 list-disc space-y-1"
            >
              {project.changes.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </Surface>
          )}
          {!!project.retained.length && (
            <Surface
              as="ul"
              variant="body"
              tone="muted"
              textRole="body-small"
              className="mt-2 list-disc space-y-1"
            >
              {project.retained.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </Surface>
          )}
          {!!project.blockers.length && (
            <Surface
              as="div"
              variant="notice"
              tone="warning"
              textRole="body-small"
              className="mt-2"
            >
              <p>Resolve Before Publishing</p>
              <Surface
                as="ul"
                variant="body"
                className="mt-1 list-disc space-y-1"
              >
                {project.blockers.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </Surface>
            </Surface>
          )}
          {!project.completed && (
            <Surface
              as="label"
              variant="inline-field"
              textRole="body-small"
              className="mt-3 flex items-start"
            >
              <CheckInput
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
                <Text as="span" tone="muted" className="mt-1 block">
                  Selecting this refreshes the impact preview. Leave unchecked
                  to retain the original deadlines for active steps.
                </Text>
              </span>
            </Surface>
          )}
        </Surface>
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
        size="lg"
        className="overflow-y-auto"
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
          <Text as="p" tone="muted" textRole="body-main">
            Checking template and project revisions…
          </Text>
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
          <Text role="alert" as="p" tone="danger" textRole="body-main">
            {error}
          </Text>
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
