import {
  Surface,
  Disclosure,
  DisclosureSummary,
  Text,
} from '@/components/ui/presentation';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useState } from 'react';
import { FolderArchive, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { getLocalWorkspace } from '../workbench/workspace-client';
import {
  listProjectFiles,
  moveProjectArchive,
  type ProjectArchiveLocation,
} from './project-files';
import { projectDetails, type ProjectDetails } from './project-details';
import { ArchiveFolderButton } from './project-files-panel';
import type { Project } from './types';
import { ProjectTagsInput } from './project-tags-input';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to save project.';

/** Project references and the physical archive have independent save actions. */
export function ProjectEditDialog({
  project,
  onClose,
  onSave,
  tagSuggestions = [],
}: {
  project: Project;
  tagSuggestions?: string[];
  onClose: () => void;
  onSave: (details: ProjectDetails, baseline: ProjectDetails) => Promise<void>;
}) {
  const [details, setDetails] = useState<ProjectDetails>({
    tags: [...(project.tags ?? [])],
    name: project.name,
    client: project.client,
    proposalNumber: '',
    companyUrl: '',
    cpqUrl: '',
    scopeBrief: '',
    technicalBasis: '',
  });
  const [baseline, setBaseline] = useState<ProjectDetails | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [location, setLocation] = useState<ProjectArchiveLocation | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [folderError, setFolderError] = useState('');
  const [folderNotice, setFolderNotice] = useState('');
  const [moving, setMoving] = useState(false);
  const [folderLoading, setFolderLoading] = useState(true);
  const [folderReload, setFolderReload] = useState(0);
  const busy = saving || moving;
  const folderDirty = Boolean(
    location && projectPath.trim() !== location.projectPath,
  );
  const detailsDirty = Boolean(
    baseline && JSON.stringify(details) !== JSON.stringify(baseline),
  );
  useEffect(() => {
    let cancelled = false;
    void getLocalWorkspace(project.id)
      .then((record) => {
        if (cancelled) return;
        if (!record)
          throw new Error(
            'Project no longer exists. Refresh the project list.',
          );
        const current = projectDetails(record.workspace);
        setDetails(current);
        setBaseline(current);
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);
  useEffect(() => {
    let cancelled = false;
    void listProjectFiles(project.id)
      .then((archive) => {
        if (cancelled) return;
        setLocation(archive);
        setProjectPath(archive.projectPath);
        setFolderError('');
      })
      .catch((cause) => {
        if (!cancelled) setFolderError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setFolderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, folderReload]);
  const save = async () => {
    if (
      !baseline ||
      busy ||
      folderDirty ||
      !details.name.trim() ||
      !details.client.trim()
    )
      return;
    setSaving(true);
    setError('');
    try {
      await onSave(details, baseline);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };
  const move = async () => {
    if (!location || busy || !folderDirty || !projectPath.trim()) return;
    setMoving(true);
    setFolderError('');
    setFolderNotice('');
    try {
      const result = await moveProjectArchive(
        project.id,
        projectPath.trim(),
        location.projectPath,
      );
      setLocation(result);
      setProjectPath(result.projectPath);
      setFolderNotice(
        'Project folder updated. Existing documents remain available.',
      );
    } catch (cause) {
      setFolderError(errorMessage(cause));
    } finally {
      setMoving(false);
    }
  };
  const field = (
    key: Exclude<keyof ProjectDetails, 'tags'>,
    label: string,
    required = false,
  ) => (
    <Surface as="label" variant="field" textRole="body-small" className="block">
      {label}
      <Input
        value={details[key]}
        onChange={(event) =>
          setDetails((previous) => ({ ...previous, [key]: event.target.value }))
        }
        disabled={busy || !baseline}
        required={required}
        type={key.endsWith('Url') ? 'url' : 'text'}
        maxLength={key.endsWith('Url') ? 2048 : 200}
      />
    </Surface>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        size="md"
        showCloseButton={!busy}
        className="overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>{project.name}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-3">
              {field('name', 'Project Name', true)}
            </div>
            <div className="sm:col-span-3">
              {field('client', 'Client', true)}
            </div>
            <div className="sm:col-span-2">
              {field('proposalNumber', 'Proposal Number')}
            </div>
            <div className="sm:col-span-2">
              {field('companyUrl', 'iSales Link')}
            </div>
            <div className="sm:col-span-2">{field('cpqUrl', 'CPQ Link')}</div>
          </div>
          <ProjectTagsInput
            value={details.tags}
            suggestions={tagSuggestions}
            disabled={busy || !baseline}
            onChange={(tags) => setDetails((current) => ({ ...current, tags }))}
          />
          <Disclosure>
            <DisclosureSummary className="cursor-pointer">
              Scope & Technical Basis
            </DisclosureSummary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {(['scopeBrief', 'technicalBasis'] as const).map((key) => (
                <Surface
                  key={key}
                  as="label"
                  variant="field"
                  textRole="body-small"
                  className="block"
                >
                  {key === 'scopeBrief' ? 'Scope Brief' : 'Technical Basis'}
                  <Textarea
                    className="min-h-24 w-full"
                    value={details[key]}
                    disabled={busy || !baseline}
                    maxLength={4000}
                    onChange={(event) =>
                      setDetails((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </Surface>
              ))}
            </div>
          </Disclosure>
          <Surface
            aria-label="Project Folder"
            as="section"
            variant="panel"
            padded
            className="space-y-2"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2">
                <FolderArchive className="size-4" />
                Project Folder
              </h3>
              <Button
                type="button"
                size="icon"
                variant="ghost"

                aria-label="Reload project folder"
                disabled={busy || folderLoading}
                onClick={() => {
                  setFolderLoading(true);
                  setFolderNotice('');
                  setFolderReload((value) => value + 1);
                }}
              >
                <RefreshCw className="size-4" />
              </Button>
            </div>
            <Input
              aria-label="Project folder path"

              value={projectPath}
              placeholder={
                folderLoading
                  ? 'Loading project folder…'
                  : 'Absolute path to this project folder'
              }
              disabled={busy || folderLoading || !location}
              onChange={(event) => {
                setProjectPath(event.target.value);
                setFolderNotice('');
              }}
            />
            <ArchiveFolderButton
              key={project.id}
              projectId={project.id}
              description="Open saved project archive folder"
              disabled={busy || folderLoading || !location}
            />
            <Text as="p" tone="muted" textRole="body-small">
              Enter a new project folder on the computer running the workbench,
              then apply to move its documents. Pasted quoted paths, file URLs
              and ~/ paths are supported. The destination folder must not exist.
            </Text>
            {folderDirty && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !projectPath.trim()}
                  onClick={() => void move()}
                >
                  {moving ? 'Moving…' : 'Apply Folder'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setProjectPath(location?.projectPath || '');
                    setFolderError('');
                  }}
                >
                  Reset
                </Button>
                <Text as="span" tone="muted" textRole="body-small">
                  Apply or reset before saving project info.
                </Text>
              </div>
            )}
            {folderError && (
              <Text role="alert" as="p" tone="danger" textRole="body-small">
                {folderError}
              </Text>
            )}
            {folderNotice && (
              <Text
                as="output"
                tone="success"
                textRole="body-small"
                className="block"
              >
                {folderNotice}
              </Text>
            )}
          </Surface>
          {error && (
            <Text role="alert" as="p" tone="danger" textRole="body-main">
              {error}
            </Text>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !baseline ||
                !detailsDirty ||
                folderDirty ||
                !details.name.trim() ||
                !details.client.trim()
              }
            >
              {saving ? 'Saving…' : 'Save Project Info'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
