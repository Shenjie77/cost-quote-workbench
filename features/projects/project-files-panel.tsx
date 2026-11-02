import { Badge } from '@/components/ui/badge';
import { Text, Surface } from '@/components/ui/presentation';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import {
  Download,
  FolderArchive,
  FolderOpen,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  archiveProjectFile,
  deleteProjectFile,
  getArchiveSettings,
  listProjectFiles,
  MAX_PROJECT_FILE_BYTES,
  openArchiveFolder,
  projectFileDownloadUrl,
  projectFileSizeLabel,
  updateArchiveSettings,
  type ArchiveSettings,
  type ProjectFileArchive,
  type ProjectFileFilter,
  type ProjectFileRecord,
} from './project-files';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Unable to access the file archive.';
const dateLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-SG', {
        timeZone: 'Asia/Singapore',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(value))
    : value;

/** Opens the persisted folder for a root, project or document, with local request feedback. */
export function ArchiveFolderButton({
  projectId,
  fileId,
  disabled = false,
  label = 'Open Folder',
  category,
  description,
}: {
  projectId?: string;
  fileId?: string;
  disabled?: boolean;
  label?: string;
  category?: 'cost' | 'quotation' | 'workflow';
  description: string;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const open = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    setError('');
    try {
      await openArchiveFolder(projectId, fileId, category);
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      if (mounted.current) setOpening(false);
    }
  };
  return (
    <div className="min-w-0">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled || opening}
        aria-label={description}
        title={description}
        onClick={() => void open()}
      >
        <FolderOpen className="size-4" /> {opening ? 'Opening…' : label}
      </Button>
      {error && (
        <Text
          role="alert"
          as="p"
          tone="danger"
          textRole="body-small"
          className="max-w-xs break-words"
        >
          {error}
        </Text>
      )}
    </div>
  );
}

/** An absolute path belongs to the local API host, not the browser's download folder. */
export function ArchiveSettingsPanel({
  onBlockedChange,
  disabled = false,
}: {
  onBlockedChange?: (blocked: boolean) => void;
  disabled?: boolean;
}) {
  const [settings, setSettings] = useState<ArchiveSettings | null>(null);
  const [rootPath, setRootPath] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const dirty = Boolean(settings && rootPath.trim() !== settings.rootPath);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void getArchiveSettings()
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setRootPath(value.rootPath);
        setError('');
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);
  useEffect(() => {
    onBlockedChange?.(
      !settings || loading || saving || dirty || Boolean(error),
    );
  }, [dirty, error, loading, onBlockedChange, saving, settings]);
  const save = async () => {
    if (!settings || !rootPath.trim() || disabled || saveInFlight.current)
      return;
    saveInFlight.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = await updateArchiveSettings(
        rootPath.trim(),
        settings.revision,
      );
      if (!mounted.current) return;
      setSettings(next);
      setRootPath(next.rootPath);
      setNotice('Archive folder saved. New projects will use this location.');
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause));
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <Surface
      aria-label="Archive Settings"
      as="section"
      variant="panel"
      padded
      className="space-y-2"
    >
      <div>
        <h3 className="flex flex-wrap items-center gap-2">
          <FolderArchive className="size-4" /> Project Archive Folder
        </h3>
        <Text as="p" tone="muted" textRole="body-small" className="mt-1">
          A project folder is created here when you create a project. Each
          workflow round and step keeps its own documents.
        </Text>
      </div>
      <Surface
        as="label"
        variant="field"
        textRole="body-small"
        className="block"
      >
        Server folder · absolute path
        <Input
          aria-label="Project archive root folder"
          value={rootPath}
          placeholder={
            loading
              ? 'Loading archive folder…'
              : 'Enter an absolute folder path'
          }
          disabled={disabled || loading || saving || !settings}
          onChange={(event) => {
            setRootPath(event.target.value);
            setNotice('');
          }}
        />
      </Surface>
      <div className="flex flex-wrap items-center gap-2">
        <ArchiveFolderButton
          description="Open saved project archive root folder"
          disabled={disabled || loading || saving || !settings}
        />
        <Button
          type="button"
          size="sm"
          disabled={disabled || loading || saving || !dirty || !rootPath.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save Folder'}
        </Button>
        {dirty && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || saving}
            onClick={() => {
              setRootPath(settings?.rootPath || '');
              setError('');
            }}
          >
            Reset
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || loading || saving}
          onClick={() => {
            setLoading(true);
            setNotice('');
            setReload((value) => value + 1);
          }}
        >
          <RefreshCw /> {error ? 'Retry / Reload' : 'Reload'}
        </Button>
      </div>
      <Text as="p" tone="muted" textRole="body-small">
        Changes apply to new projects only. Existing project folders remain in
        their original location.
      </Text>
      {dirty && (
        <Text as="p" tone="warning" textRole="body-small">
          Save or reset the folder change before creating a project.
        </Text>
      )}
      {error && (
        <Text role="alert" as="p" tone="danger" textRole="body-small">
          {error}
        </Text>
      )}
      {notice && (
        <Text
          as="output"
          tone="success"
          textRole="body-small"
          className="block"
        >
          {notice}
        </Text>
      )}
    </Surface>
  );
}

/** Keep download, containing folder and delete actions adjacent to each archived document. */
export function ProjectFileList({
  projectId,
  files,
  showAssociation = false,
  onDelete,
  deletingFileId,
  disabled = false,
}: {
  projectId: string;
  files: ProjectFileRecord[];
  showAssociation?: boolean;
  onDelete?: (file: ProjectFileRecord) => void;
  deletingFileId?: string | null;
  disabled?: boolean;
}) {
  if (!files.length)
    return (
      <Surface as="p" variant="body" tone="muted" textRole="body-small">
        No documents archived yet.
      </Surface>
    );
  return (
    <Surface
      as="ul"
      variant="footer"
      className="max-h-80 overflow-y-auto"
      aria-label="Archived documents"
    >
      {files.map((file) => (
        <Surface
          key={file.id}
          as="li"
          variant="body"
          className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
        >
          <div className="min-w-0 flex-1 basis-52">
            <Text
              as="p"
              textRole="body-main"
              className="break-words"
              title={file.relativePath}
            >
              {file.originalName}
            </Text>
            <Text
              as="p"
              tone="muted"
              textRole="body-small"
              className="mt-1 flex flex-wrap gap-x-3 gap-y-1"
            >
              <span>{projectFileSizeLabel(file.sizeBytes)}</span>
              <time dateTime={file.createdAt}>
                {dateLabel(file.createdAt)} SGT
              </time>
              {showAssociation && (
                <span className="capitalize">
                  {[
                    file.category,
                    file.versionCode,
                    file.nodeName || file.nodeCode,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </Text>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Surface
              href={projectFileDownloadUrl(projectId, file.id)}
              download={file.originalName}
              as="a"
              variant="body"
              tone="primary"
              textRole="body-small"
              className="inline-flex min-h-8 shrink-0 items-center gap-2"
              aria-label={`Download ${file.originalName}`}
            >
              <Download className="size-4" /> Download
            </Surface>
            <ArchiveFolderButton
              key={JSON.stringify([projectId, file.id])}
              projectId={projectId}
              fileId={file.id}
              description={`Open folder for ${file.originalName}`}
              disabled={disabled || Boolean(deletingFileId)}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"

              aria-label={`Delete ${file.originalName}`}
              disabled={disabled || Boolean(deletingFileId) || !onDelete}
              onClick={() => onDelete?.(file)}
            >
              <Trash2 className="size-4" />{' '}
              {deletingFileId === file.id ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Surface>
      ))}
    </Surface>
  );
}

type UploadItem = {
  file: File;
  requestId: string;
  status: 'pending' | 'uploading' | 'failed';
  error?: string;
};
type ProjectFilesPanelProps = {
  projectId: string;
  nodeCode?: string;
  nodeName?: string;
  versionCode?: string;
  refreshKey?: number;
  onArchived?: () => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
};

const isFileDrag = (event: DragEvent<HTMLElement>) =>
  Array.from(event.dataTransfer.types || []).includes('Files') ||
  event.dataTransfer.files.length > 0;

/** The entire archive card accepts files; the native button also works by keyboard. */
export function ProjectFileDropzone({
  title,
  target,
  versionCode,
  node = false,
  dragging = false,
  disabled = false,
  uploading = false,
  loading = false,
  onDraggingChange,
  onFiles,
  onBrowse,
  onRefresh,
  children,
}: {
  title: string;
  target: string;
  versionCode?: string;
  node?: boolean;
  dragging?: boolean;
  disabled?: boolean;
  uploading?: boolean;
  loading?: boolean;
  onDraggingChange: (dragging: boolean) => void;
  onFiles: (files: File[]) => void;
  onBrowse: () => void;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  const unavailable = disabled || uploading;
  const dragOver = (event: DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = unavailable ? 'none' : 'copy';
    onDraggingChange(!unavailable);
  };
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The native picker button provides the keyboard equivalent of this region's file drop.
    <Surface
      aria-label={node ? 'Workflow Step Documents' : 'Project File Archive'}
      as="section"
      variant="panel"
      selected={dragging && !unavailable}
      tone={'inherit'}
      className="min-w-0 space-y-2"
      padded
      onDragEnter={dragOver}
      onDragOver={dragOver}
      onDragLeave={(event) => {
        if (
          event.relatedTarget &&
          typeof Node !== 'undefined' &&
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        onDraggingChange(false);
      }}
      onDrop={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onDraggingChange(false);
        if (!unavailable) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="flex flex-wrap items-center gap-2">
            {title}
            {versionCode && <Badge tone="neutral">{versionCode}</Badge>}
          </h3>
          <Text
            as="p"
            tone="muted"
            textRole="body-small"
            className="mt-1 break-all"
          >
            {target}
          </Text>
        </div>
        {/* Browse and refresh remain adjacent to the document list they affect. */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            type="button"
            aria-label={`Choose files for ${target}`}
            disabled={unavailable}
            onClick={onBrowse}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-2 text-left disabled:cursor-wait"
          >
            <Upload className="size-4" aria-hidden="true" />
            {uploading
              ? 'Uploading files…'
              : dragging && !disabled
                ? 'Release to upload'
                : 'Browse files'}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={loading}
            onClick={onRefresh}
            aria-label={
              node ? 'Refresh step documents' : 'Refresh project files'
            }
            title="Refresh documents"
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>
      <Text as="p" tone="muted" textRole="body-small">
        {uploading
          ? 'Files are being archived'
          : disabled
            ? 'Wait for the current update'
            : 'Drop files here · or click to browse · 50 MiB per file'}
      </Text>
      {children}
    </Surface>
  );
}

/** Re-mount the controller on association changes so pending requests cannot replace another node's files. */
export function ProjectFilesPanel(props: ProjectFilesPanelProps) {
  return (
    <ProjectFilesController
      key={JSON.stringify([props.projectId, props.nodeCode, props.versionCode])}
      {...props}
    />
  );
}

function ProjectFilesController({
  projectId,
  nodeCode,
  nodeName,
  versionCode,
  refreshKey = 0,
  onArchived,
  onUploadingChange,
  disabled = false,
}: ProjectFilesPanelProps) {
  const isNode = Boolean(nodeCode);
  const [dragging, setDragging] = useState(false);
  const [archive, setArchive] = useState<ProjectFileArchive | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const live = useRef(false);
  const uploadingRef = useRef(false);
  const deletingRef = useRef(false);
  const selectionRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    return () => {
      onUploadingChange?.(false);
    };
  }, [onUploadingChange]);
  useEffect(() => {
    if (!uploading) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [uploading]);
  useEffect(() => {
    let cancelled = false;
    const filter: ProjectFileFilter = isNode
      ? { category: 'workflow', nodeCode, versionCode }
      : {};
    void listProjectFiles(projectId, filter)
      .then((value) => {
        if (cancelled) return;
        setArchive(value);
        setError('');
      })
      .catch((cause) => {
        if (!cancelled) setError(errorMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, nodeCode, versionCode, isNode, reload, refreshKey]);

  /** Confirm one named document, then refresh both archive views only after deletion succeeds. */
  const remove = async (file: ProjectFileRecord) => {
    if (disabled || uploadingRef.current || deletingRef.current || loading)
      return;
    if (
      !window.confirm(
        `Delete "${file.originalName}" from this project's archive?`,
      )
    )
      return;
    deletingRef.current = true;
    setDeletingFileId(file.id);
    setError('');
    setNotice('');
    try {
      await deleteProjectFile(projectId, file.id);
      if (!live.current) return;
      setNotice(`Deleted "${file.originalName}".`);
      setLoading(true);
      setReload((value) => value + 1);
      onArchived?.();
    } catch (cause) {
      // Leave the existing list intact so a failed delete never hides a document.
      if (live.current) setError(errorMessage(cause));
    } finally {
      deletingRef.current = false;
      if (live.current) setDeletingFileId(null);
    }
  };

  const upload = async (items: UploadItem[]) => {
    if (
      disabled ||
      uploadingRef.current ||
      deletingRef.current ||
      !items.length
    )
      return;
    uploadingRef.current = true;
    onUploadingChange?.(true);
    setUploading(true);
    setNotice('');
    let count = 0;
    for (const item of items) {
      if (!live.current) break;
      setQueue((previous) =>
        previous.map((row) =>
          row.requestId === item.requestId
            ? { ...row, status: 'uploading', error: undefined }
            : row,
        ),
      );
      try {
        await archiveProjectFile(projectId, item.file, {
          category: isNode ? 'workflow' : 'general',
          ...(isNode ? { nodeCode, versionCode } : {}),
          requestId: item.requestId,
        });
        count += 1;
        if (live.current)
          setQueue((previous) =>
            previous.filter((row) => row.requestId !== item.requestId),
          );
      } catch (cause) {
        if (live.current)
          setQueue((previous) =>
            previous.map((row) =>
              row.requestId === item.requestId
                ? { ...row, status: 'failed', error: errorMessage(cause) }
                : row,
            ),
          );
      }
    }
    uploadingRef.current = false;
    if (!live.current) return;
    setUploading(false);
    onUploadingChange?.(false);
    if (count) {
      setNotice(`${count} document${count === 1 ? '' : 's'} archived.`);
      setReload((value) => value + 1);
      onArchived?.();
    }
  };
  const selectFiles = (files: File[]) => {
    if (disabled || uploadingRef.current || deletingRef.current) return;
    const items: UploadItem[] = files.map((file) => ({
      file,
      requestId: crypto.randomUUID(),
      status: file.size > MAX_PROJECT_FILE_BYTES ? 'failed' : 'pending',
      ...(file.size > MAX_PROJECT_FILE_BYTES
        ? { error: 'Each file must be 50 MiB or smaller.' }
        : {}),
    }));
    setQueue((previous) => [...previous, ...items]);
    void upload(items.filter((item) => item.status === 'pending'));
  };
  return (
    <ProjectFileDropzone
      title={isNode ? 'Documents' : 'Project Files'}
      target={
        isNode
          ? archive?.uploadFolder || `workflow / ${nodeName || nodeCode}`
          : 'All project documents · Drop uploads to workflow'
      }
      versionCode={isNode ? versionCode : undefined}
      node={isNode}
      dragging={dragging}
      disabled={disabled || Boolean(deletingFileId)}
      uploading={uploading}
      loading={loading}
      onDraggingChange={setDragging}
      onFiles={selectFiles}
      onBrowse={() => selectionRef.current?.click()}
      onRefresh={() => {
        setLoading(true);
        setReload((value) => value + 1);
      }}
    >
      <Input
        ref={selectionRef}
        type="file"
        multiple
        className="sr-only"
        aria-label={isNode ? 'Choose step documents' : 'Choose project files'}
        disabled={disabled || uploading || Boolean(deletingFileId)}
        onChange={(event) => {
          selectFiles(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      {!isNode && archive && (
        <div className="flex flex-wrap items-center gap-2">
          <Surface
            as="p"
            variant="inset"
            textRole="body-small"
            className="min-w-0 flex-1 basis-72 break-all"
            title="Project archive folder"
          >
            {archive.projectPath}
          </Surface>
          <ArchiveFolderButton
            key={projectId}
            projectId={projectId}
            description="Open saved project archive folder"
            disabled={
              disabled || loading || uploading || Boolean(deletingFileId)
            }
          />
        </div>
      )}
      {loading && (
        <Text as="output" tone="muted" textRole="body-small" className="block">
          Loading documents…
        </Text>
      )}
      {error && (
        <Surface
          role="alert"
          as="div"
          variant="notice"
          tone="danger"
          textRole="body-small"
          className="flex flex-wrap items-center gap-2"
        >
          <span>{error}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setReload((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </Surface>
      )}
      {archive && (
        <ProjectFileList
          projectId={projectId}
          files={archive.files}
          showAssociation={!isNode}
          onDelete={(file) => void remove(file)}
          deletingFileId={deletingFileId}
          disabled={disabled || loading || uploading}
        />
      )}
      {queue.length > 0 && (
        <ul className="space-y-2" aria-label="Upload queue">
          {queue.map((item) => (
            <Surface
              key={item.requestId}
              as="li"
              variant="panel"
              padded
              textRole="body-small"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="min-w-0 flex-1 break-words">
                {item.file.name} · {projectFileSizeLabel(item.file.size)}
              </span>
              {item.status === 'failed' ? (
                <>
                  <Text role="alert" as="span" tone="danger" className="w-full">
                    {item.error}
                  </Text>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled ||
                      uploading ||
                      item.file.size > MAX_PROJECT_FILE_BYTES
                    }
                    onClick={() => void upload([item])}
                  >
                    Retry Upload
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() =>
                      setQueue((previous) =>
                        previous.filter(
                          (row) => row.requestId !== item.requestId,
                        ),
                      )
                    }
                  >
                    Dismiss
                  </Button>
                </>
              ) : (
                <span>
                  {item.status === 'uploading' ? 'Uploading…' : 'Waiting…'}
                </span>
              )}
            </Surface>
          ))}
        </ul>
      )}
      {notice && (
        <Text
          as="output"
          tone="success"
          textRole="body-small"
          className="block"
        >
          {notice}
        </Text>
      )}
    </ProjectFileDropzone>
  );
}
