/** Global detail-sheet router for projects, persisted reviews, and creation. */

import { useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { StatusBadge } from '@/components/workbench/status-badge';
import type { Project } from '@/features/projects/types';
import {
  getReviewTiming,
  reviewStatusLabels,
  type ReviewGate,
  type ReviewStatus,
} from '@/features/reviews/types';
import type { PanelState, ViewKey } from '@/features/workbench/types';

const createReviewDraft = (projectId: string): ReviewGate => ({
  id: `review-${globalThis.crypto.randomUUID()}`,
  projectId,
  gate: 'New Review Gate',
  gateZh: '新评审节点',
  owner: 'Me',
  dueDate: new Date().toISOString().slice(0, 10),
  status: 'not_started',
  note: '',
  noteZh: '',
  workflowStepCode: '',
  lastUpdatedAt: new Date().toISOString(),
  followUps: [],
});

export function DetailSheet({
  panel,
  setPanel,
  setView,
  projects,
  onCreateProject,
  onSelectProject,
  onSaveReview,
  onDeleteReview,
  announce,
}: {
  panel: PanelState;
  setPanel: (panel: PanelState) => void;
  setView: (view: ViewKey) => void;
  projects: Project[];
  onCreateProject: (input: {
    name: string;
    client: string;
    owner: string;
  }) => void;
  onSelectProject: (project: Project) => void;
  onSaveReview: (review: ReviewGate) => Promise<boolean>;
  onDeleteReview: (projectId: string, reviewId: string) => Promise<boolean>;
  announce: (message: string) => void;
}) {
  const [projectName, setProjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [projectOwner, setProjectOwner] = useState('Me');
  const [reviewDraft, setReviewDraft] = useState<ReviewGate | null>(() => {
    if (panel?.type === 'review') return structuredClone(panel.review);
    if (panel?.type === 'new-review') {
      return createReviewDraft(panel.projectId || projects[0]?.id || '');
    }
    return null;
  });
  const [followUpSummary, setFollowUpSummary] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  const riskLabels = {
    high: ['High risk', '高风险'],
    medium: ['Medium risk', '中风险'],
    low: ['Low risk', '低风险'],
  } as const;

  const reviewProject = reviewDraft
    ? projects.find((project) => project.id === reviewDraft.projectId)
    : undefined;
  const reviewTiming = reviewDraft ? getReviewTiming(reviewDraft) : null;
  const updateReview = <K extends keyof ReviewGate>(
    key: K,
    value: ReviewGate[K],
  ) =>
    setReviewDraft((current) =>
      current ? { ...current, [key]: value } : current,
    );

  /** Appends an immutable follow-up entry and synchronizes explicit status. */
  const logFollowUp = async () => {
    if (!reviewDraft || !followUpSummary.trim()) return;
    const updated: ReviewGate = {
      ...reviewDraft,
      lastUpdatedAt: new Date().toISOString(),
      followUps: [
        {
          id: `follow-up-${globalThis.crypto.randomUUID()}`,
          createdAt: new Date().toISOString(),
          summary: followUpSummary.trim(),
          statusAfter: reviewDraft.status,
          nextFollowUpAt,
        },
        ...reviewDraft.followUps,
      ],
    };
    if (await onSaveReview(updated)) {
      setReviewDraft(updated);
      setFollowUpSummary('');
      setNextFollowUpAt('');
      announce('Follow-up logged and saved. / 跟进记录已保存。');
    }
  };

  return (
    <Sheet
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) setPanel(null);
      }}
    >
      <SheetContent className="w-[min(560px,94vw)] sm:max-w-[560px]">
        {panel?.type === 'project' ? (
          <>
            <SheetHeader className="border-b border-border p-5 pr-12">
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge
                  tone={
                    panel.project.risk === 'high'
                      ? 'red'
                      : panel.project.risk === 'medium'
                        ? 'amber'
                        : 'green'
                  }
                >
                  <BiInline
                    en={riskLabels[panel.project.risk][0]}
                    zh={riskLabels[panel.project.risk][1]}
                  />
                </StatusBadge>
                <span className="financial-numeral text-[10px] text-muted-foreground">
                  {panel.project.id}
                </span>
              </div>
              <SheetTitle className="text-lg leading-6">
                {panel.project.name}
              </SheetTitle>
              <SheetDescription>
                {panel.project.nameZh} · {panel.project.client} ·{' '}
                {panel.project.stage}
              </SheetDescription>
            </SheetHeader>
            <div className="workbench-scrollbar flex-1 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-px border border-border bg-border">
                <div className="bg-card p-4">
                  <BiText
                    en="Latest Cost"
                    zh="最新成本"
                    className="text-[10px] text-muted-foreground"
                  />
                  <p className="financial-numeral mt-2 text-lg font-semibold">
                    {panel.project.cost}
                  </p>
                </div>
                <div className="bg-card p-4">
                  <BiText
                    en="Cost Version"
                    zh="成本版本"
                    className="text-[10px] text-muted-foreground"
                  />
                  <p className="financial-numeral mt-2 text-lg font-semibold">
                    {panel.project.version}
                  </p>
                  <p className="text-[9px] text-muted-foreground">
                    {panel.project.versionState} /{' '}
                    {panel.project.versionStateZh}
                  </p>
                </div>
              </div>
              <div className="mt-6">
                <div className="flex justify-between text-xs">
                  <span>
                    Workflow Progress{' '}
                    <span className="text-[9px] text-muted-foreground">
                      流程完成度
                    </span>
                  </span>
                  <span className="financial-numeral">
                    {panel.project.progress}%
                  </span>
                </div>
                <Progress
                  value={panel.project.progress}
                  className="mt-2 [&_[data-slot=progress-indicator]]:bg-[#2e6f77]"
                />
              </div>
              <div className="mt-6 border-t border-border pt-5">
                <BiText
                  en="Next Review"
                  zh="下一评审"
                  className="text-xs font-semibold"
                />
                <div className="mt-3 flex items-start gap-3 border border-[#dfc99e] bg-[#f8f1e4] p-4">
                  <CalendarDays className="mt-0.5 size-4 text-[#8d5b12]" />
                  <div>
                    <p className="text-xs font-semibold">
                      {panel.project.nextReview}
                    </p>
                    <p className="mt-1 text-[9px] text-[#77501c]">
                      {panel.project.nextReviewZh} · Owner:{' '}
                      {panel.project.reviewOwner}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <SheetFooter className="border-t border-border bg-[#f5f3ed]">
              <Button
                onClick={() => {
                  onSelectProject(panel.project);
                  setPanel(null);
                  setView('project');
                }}
              >
                Open Project List <ArrowRight />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onSelectProject(panel.project);
                  setPanel(null);
                  setView('cost');
                }}
              >
                Open Cost
              </Button>
            </SheetFooter>
          </>
        ) : null}

        {(panel?.type === 'review' || panel?.type === 'new-review') &&
        reviewDraft ? (
          <>
            <SheetHeader className="border-b border-border p-5 pr-12">
              <div className="mb-2 flex items-center gap-2">
                <StatusBadge tone={reviewStatusLabels[reviewDraft.status].tone}>
                  <BiInline
                    en={reviewStatusLabels[reviewDraft.status].en}
                    zh={reviewStatusLabels[reviewDraft.status].zh}
                  />
                </StatusBadge>
                {reviewTiming ? (
                  <StatusBadge tone={reviewTiming.tone}>
                    <BiInline en={reviewTiming.en} zh={reviewTiming.zh} />
                  </StatusBadge>
                ) : null}
              </div>
              <SheetTitle className="text-lg">
                {panel.type === 'new-review'
                  ? 'New Review Gate / 新建评审节点'
                  : reviewDraft.gate}
              </SheetTitle>
              <SheetDescription>
                {reviewProject?.name || reviewDraft.projectId} ·{' '}
                {reviewDraft.id}
              </SheetDescription>
            </SheetHeader>
            <div className="workbench-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <BiText
                  en="Project"
                  zh="项目"
                  className="text-xs font-medium"
                />
                <Select
                  value={reviewDraft.projectId}
                  onValueChange={(value) => {
                    updateReview('projectId', value ?? '');
                    updateReview('workflowStepCode', '');
                  }}
                  disabled={panel.type === 'review'}
                >
                  <SelectTrigger className="mt-2 w-full" aria-label="Project">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name} · {project.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label htmlFor="review-gate">
                  <BiText
                    en="Gate Name"
                    zh="英文节点名"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="review-gate"
                    className="mt-2"
                    value={reviewDraft.gate}
                    onChange={(event) =>
                      updateReview('gate', event.target.value)
                    }
                  />
                </label>
                <label htmlFor="review-gate-zh">
                  <BiText
                    en="Chinese Name"
                    zh="中文节点名"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="review-gate-zh"
                    className="mt-2"
                    value={reviewDraft.gateZh}
                    onChange={(event) =>
                      updateReview('gateZh', event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label htmlFor="review-owner">
                  <BiText
                    en="Owner"
                    zh="负责人"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="review-owner"
                    className="mt-2"
                    value={reviewDraft.owner}
                    onChange={(event) =>
                      updateReview('owner', event.target.value)
                    }
                  />
                </label>
                <label htmlFor="review-due-date">
                  <BiText
                    en="Due Date"
                    zh="期限"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="review-due-date"
                    className="mt-2"
                    type="date"
                    value={reviewDraft.dueDate}
                    onChange={(event) =>
                      updateReview('dueDate', event.target.value)
                    }
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <BiText
                    en="Status"
                    zh="状态"
                    className="text-xs font-medium"
                  />
                  <Select
                    value={reviewDraft.status}
                    onValueChange={(value) =>
                      updateReview(
                        'status',
                        (value ?? 'not_started') as ReviewStatus,
                      )
                    }
                  >
                    <SelectTrigger
                      className="mt-2 w-full"
                      aria-label="Review status"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(reviewStatusLabels) as ReviewStatus[]).map(
                        (status) => (
                          <SelectItem key={status} value={status}>
                            {reviewStatusLabels[status].en} /{' '}
                            {reviewStatusLabels[status].zh}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <BiText
                    en="Linked Workflow"
                    zh="关联流程"
                    className="text-xs font-medium"
                  />
                  <Select
                    value={reviewDraft.workflowStepCode || '__NONE__'}
                    onValueChange={(value) =>
                      updateReview(
                        'workflowStepCode',
                        !value || value === '__NONE__' ? '' : value,
                      )
                    }
                  >
                    <SelectTrigger
                      className="mt-2 w-full"
                      aria-label="Linked workflow"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__NONE__">None / 不关联</SelectItem>
                      {(reviewProject?.workflowSteps || []).map((step) => (
                        <SelectItem key={step.code} value={step.code}>
                          {step.no} · {step.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <label htmlFor="review-note">
                <BiText
                  en="Current Note / Evidence"
                  zh="当前说明或完成依据"
                  className="text-xs font-medium"
                />
                <Textarea
                  id="review-note"
                  className="mt-2"
                  value={reviewDraft.note}
                  onChange={(event) => updateReview('note', event.target.value)}
                />
              </label>
              <label htmlFor="review-note-zh">
                <BiText
                  en="Chinese Note"
                  zh="中文说明"
                  className="text-xs font-medium"
                />
                <Textarea
                  id="review-note-zh"
                  className="mt-2"
                  value={reviewDraft.noteZh}
                  onChange={(event) =>
                    updateReview('noteZh', event.target.value)
                  }
                />
              </label>

              {panel.type === 'review' ? (
                <div className="border-t border-border pt-4">
                  <BiText
                    en="Log Follow-up"
                    zh="记录跟进"
                    className="text-xs font-semibold"
                  />
                  <Textarea
                    className="mt-2"
                    placeholder="What was confirmed, by whom, and the next action? / 本次确认内容与下一动作"
                    value={followUpSummary}
                    onChange={(event) => setFollowUpSummary(event.target.value)}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="date"
                      value={nextFollowUpAt}
                      onChange={(event) =>
                        setNextFollowUpAt(event.target.value)
                      }
                      aria-label="Next follow-up date"
                    />
                    <Button
                      onClick={() => void logFollowUp()}
                      disabled={!followUpSummary.trim()}
                    >
                      <Plus /> Log / 记录
                    </Button>
                  </div>
                  <div className="mt-4 space-y-2">
                    {reviewDraft.followUps.map((followUp) => (
                      <div
                        key={followUp.id}
                        className="border border-border bg-[#f8f7f3] p-3 text-[10px]"
                      >
                        <div className="flex justify-between text-muted-foreground">
                          <span>
                            {new Date(followUp.createdAt).toLocaleString(
                              'en-SG',
                            )}
                          </span>
                          <span>
                            {reviewStatusLabels[followUp.statusAfter].en}
                            {followUp.nextFollowUpAt
                              ? ` · Next ${followUp.nextFollowUpAt}`
                              : ''}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-5">
                          {followUp.summary}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <SheetFooter className="border-t border-border bg-[#f5f3ed]">
              {panel.type === 'review' ? (
                <Button
                  variant="outline"
                  className="mr-auto text-red-700"
                  onClick={async () => {
                    if (
                      window.confirm(
                        'Delete this review gate? / 确认删除该评审节点？',
                      ) &&
                      (await onDeleteReview(
                        reviewDraft.projectId,
                        reviewDraft.id,
                      ))
                    )
                      setPanel(null);
                  }}
                >
                  <Trash2 /> Delete / 删除
                </Button>
              ) : null}
              <Button
                disabled={
                  !reviewDraft.projectId ||
                  !reviewDraft.gate.trim() ||
                  !reviewDraft.owner.trim() ||
                  !reviewDraft.dueDate
                }
                onClick={async () => {
                  const saved = await onSaveReview({
                    ...reviewDraft,
                    lastUpdatedAt: new Date().toISOString(),
                  });
                  if (saved) setPanel(null);
                }}
              >
                <Save />{' '}
                {panel.type === 'new-review'
                  ? 'Create Gate / 创建'
                  : 'Save Changes / 保存'}
              </Button>
            </SheetFooter>
          </>
        ) : null}

        {panel?.type === 'new-project' ? (
          <>
            <SheetHeader className="border-b border-border p-5 pr-12">
              <SheetTitle className="text-lg">
                New Project{' '}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  新建项目
                </span>
              </SheetTitle>
              <SheetDescription>
                Creates an isolated local SQLite workspace. / 创建独立的本地
                SQLite 项目工作区。
              </SheetDescription>
            </SheetHeader>
            <div className="workbench-scrollbar flex-1 space-y-5 overflow-y-auto p-5">
              <label htmlFor="project-name">
                <BiText
                  en="Project Name"
                  zh="项目名称"
                  className="text-xs font-medium"
                />
                <Input
                  id="project-name"
                  className="mt-2"
                  placeholder="e.g. Client cloud migration service"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <label htmlFor="client-name">
                <BiText
                  en="Client Name"
                  zh="客户名称"
                  className="text-xs font-medium"
                />
                <Input
                  id="client-name"
                  className="mt-2"
                  placeholder="Enter client name"
                  value={clientName}
                  onChange={(event) => setClientName(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label htmlFor="project-owner">
                  <BiText
                    en="Project Owner"
                    zh="项目负责人"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="project-owner"
                    className="mt-2"
                    placeholder="Owner"
                    value={projectOwner}
                    onChange={(event) => setProjectOwner(event.target.value)}
                  />
                </label>
                <label htmlFor="base-currency">
                  <BiText
                    en="Base Currency"
                    zh="基准币种"
                    className="text-xs font-medium"
                  />
                  <Input
                    id="base-currency"
                    className="mt-2"
                    value="SGD"
                    readOnly
                  />
                </label>
              </div>
              <div>
                <BiText
                  en="Workflow Template"
                  zh="流程模板"
                  className="text-xs font-medium"
                />
                <div className="mt-2 flex w-full items-center justify-between border border-input bg-[#f7f5f0] px-3 py-2 text-left text-xs">
                  <BiText
                    en="Standard Service Quote · 10 stages"
                    zh="标准服务报价流程 · 10 个节点"
                  />
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </div>
              <div className="border border-[#dfc99e] bg-[#f8f1e4] p-3 text-[10px] leading-5 text-[#77501c]">
                A standard workflow is created with the project and can then be
                adjusted per project.
                <span className="block text-[9px]">
                  创建项目后自动生成标准流程，并允许按项目调整。
                </span>
              </div>
            </div>
            <SheetFooter className="border-t border-border bg-[#f5f3ed]">
              <Button
                disabled={!projectName.trim() || !clientName.trim()}
                onClick={() => {
                  onCreateProject({
                    name: projectName.trim(),
                    client: clientName.trim(),
                    owner: projectOwner.trim(),
                  });
                  setProjectName('');
                  setClientName('');
                  setProjectOwner('Me');
                }}
              >
                Create Project{' '}
                <span className="text-[9px] opacity-60">创建项目</span>
              </Button>
              <Button variant="outline" onClick={() => setPanel(null)}>
                Cancel <span className="text-[9px] opacity-60">取消</span>
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
