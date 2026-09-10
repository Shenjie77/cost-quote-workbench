/** Persisted review queue with deadline/status filters and follow-up history. */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  History,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { KpiCard } from '@/components/workbench/kpi-card';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import type { Project } from '@/features/projects/types';
import {
  getReviewTiming,
  reviewStatusLabels,
  type ReviewGate,
  type ReviewStatus,
} from '@/features/reviews/types';
import type { PanelState } from '@/features/workbench/types';

type ReviewFilter = 'open' | 'overdue' | 'due_soon' | 'stale' | ReviewStatus;

export function ReviewsView({
  projects,
  reviews,
  setPanel,
}: {
  projects: Project[];
  reviews: ReviewGate[];
  setPanel: (panel: PanelState) => void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>('open');
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const metrics = reviews.reduce(
    (total, review) => {
      const timing = getReviewTiming(review);
      const open =
        review.status !== 'completed' && review.status !== 'cancelled';
      if (open) total.open += 1;
      if (timing.overdue) total.overdue += 1;
      if (timing.daysUntilDue === 0 && open) total.today += 1;
      if (timing.stale) total.stale += 1;
      return total;
    },
    { open: 0, overdue: 0, today: 0, stale: 0 },
  );
  const visible = reviews
    .filter((review) => {
      const timing = getReviewTiming(review);
      if (filter === 'open')
        return review.status !== 'completed' && review.status !== 'cancelled';
      if (filter === 'overdue') return timing.overdue;
      if (filter === 'due_soon') return timing.dueSoon;
      if (filter === 'stale') return timing.stale;
      return review.status === filter;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="wb-page-stack">
      <section className="wb-panel flex flex-wrap items-start justify-between gap-3 bg-muted/20 px-3 py-2.5">
        <BiText
          en="One persisted queue for owners, deadlines, blockers, evidence, and follow-up records."
          zh="统一维护负责人、期限、阻塞项、完成依据和每次跟进记录。"
          className="text-[11px] font-medium text-accent-foreground"
        />
        <StatusBadge tone="green">
          <BiInline en="Live SQLite data" zh="实时本地数据" />
        </StatusBadge>
      </section>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard
          label="Open Gates"
          labelZh="待处理节点"
          value={String(metrics.open)}
          note={`${projects.length} local projects`}
          noteZh={`覆盖 ${projects.length} 个本地项目`}
          icon={ClipboardCheck}
        />
        <KpiCard
          label="Overdue"
          labelZh="已逾期"
          value={String(metrics.overdue)}
          note="Explicit deadline calculation"
          noteZh="按录入期限自动计算"
          icon={AlertTriangle}
          tone="red"
        />
        <KpiCard
          label="Due Today"
          labelZh="今日到期"
          value={String(metrics.today)}
          note="Manual status remains authoritative"
          noteZh="手工确认状态为准"
          icon={Clock3}
          tone="amber"
        />
        <KpiCard
          label="Stale"
          labelZh="长期未更新"
          value={String(metrics.stale)}
          note="No update for at least 5 days"
          noteZh="至少 5 天未更新"
          icon={History}
          tone="gray"
        />
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.45fr)_390px]">
        <section className="wb-panel">
          <SectionHeading
            index="01"
            title="Review Gates"
            titleZh="评审节点"
            description="Open a gate to update status, evidence, and follow-up history."
            descriptionZh="打开节点更新状态、完成依据和跟进历史。"
            action={
              <div className="flex items-center gap-2">
                <Select
                  value={filter}
                  onValueChange={(value) => setFilter(value as ReviewFilter)}
                >
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open / 未关闭</SelectItem>
                    <SelectItem value="overdue">Overdue / 已逾期</SelectItem>
                    <SelectItem value="due_soon">
                      Due in 3 days / 三天内
                    </SelectItem>
                    <SelectItem value="stale">Stale / 长期未更新</SelectItem>
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
                <Button
                  size="sm"
                  onClick={() =>
                    setPanel({
                      type: 'new-review',
                      projectId: projects[0]?.id || '',
                    })
                  }
                  disabled={projects.length === 0}
                >
                  <Plus /> New Gate / 新增
                </Button>
              </div>
            }
          />
          <div className="divide-y divide-border">
            {visible.length ? (
              visible.map((review) => {
                const project = projectById.get(review.projectId);
                const timing = getReviewTiming(review);
                const status = reviewStatusLabels[review.status];
                return (
                  <button
                    key={review.id}
                    onClick={() =>
                      setPanel({
                        type: 'review',
                        review,
                        projectId: review.projectId,
                      })
                    }
                    className="grid w-full grid-cols-[12px_minmax(0,1fr)_120px_110px_18px] items-center gap-4 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-accent/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring max-sm:grid-cols-[12px_minmax(0,1fr)_18px]"
                  >
                    <span
                      className={`size-2.5 rounded-full ${timing.tone === 'red' ? 'bg-destructive' : timing.tone === 'amber' ? 'bg-amber-600' : timing.tone === 'blue' ? 'bg-blue-600' : timing.tone === 'green' ? 'bg-emerald-600' : 'bg-muted-foreground'}`}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <strong className="truncate text-xs">
                          {review.gate}
                        </strong>
                        <StatusBadge tone={status.tone}>
                          <BiInline en={status.en} zh={status.zh} />
                        </StatusBadge>
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {review.gateZh} · {project?.name || review.projectId}
                        {review.costVersion
                          ? ` · 成本 ${review.costVersion}`
                          : ''}
                      </span>
                    </span>
                    <span className="max-sm:hidden">
                      <BiText
                        en="Owner"
                        zh="负责人"
                        className="text-[11px] text-muted-foreground"
                      />
                      <span className="mt-1 block text-xs font-medium">
                        {review.owner}
                      </span>
                    </span>
                    <span className="text-right max-sm:hidden">
                      <BiText
                        en={timing.en}
                        zh={timing.zh}
                        className="items-end text-[11px] text-muted-foreground"
                      />
                      <span
                        className={`financial-numeral mt-1 block text-xs font-medium ${timing.overdue ? 'text-destructive' : ''}`}
                      >
                        {review.dueDate}
                      </span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </button>
                );
              })
            ) : (
              <div className="wb-empty-state">
                No review gates match this filter. Use “New Gate” to create one.
                / 当前筛选无评审节点，可点击“新增”。
              </div>
            )}
          </div>
        </section>
        <section className="wb-panel">
          <SectionHeading
            index="02"
            title="Follow-up Rhythm"
            titleZh="跟进节奏"
            description="Rules used by the live Agent Digest and CLI output."
            descriptionZh="实时 Agent 摘要与 CLI 输出使用的规则。"
          />
          <div className="space-y-3 p-3">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-md bg-secondary text-primary">
                <Bell className="size-4" />
              </span>
              <div>
                <p className="text-xs font-semibold">Daily Digest Ready</p>
                <p className="financial-numeral mt-1 text-[11px] text-muted-foreground">
                  Agent/CLI may query at any scheduled time / Agent 可按计划查询
                </p>
              </div>
              <StatusBadge tone="green">
                <BiInline en="Live" zh="已启用" />
              </StatusBadge>
            </div>
            <div className="space-y-2 border-t border-border pt-4 text-xs">
              {[
                ['Overdue gates', '逾期节点'],
                ['Due today or within 3 days', '今日与未来 3 天到期'],
                ['Explicit blocked status', '明确标记的阻塞状态'],
                ['No update for at least 5 days', '至少 5 天未更新'],
                [
                  'Draft cost baseline requiring confirmation',
                  '需要确认的草稿成本版本',
                ],
              ].map(([en, zh]) => (
                <div key={en} className="flex items-center gap-2">
                  <Check className="size-3.5 text-emerald-700" />
                  <BiText en={en} zh={zh} />
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border bg-accent/60 p-4 text-xs leading-5 text-accent-foreground">
              The Agent never invents progress. With no new record, it reports
              “Status confirmation required.”
              <span className="block text-[11px]">
                Agent 不会推断真实进展；没有新记录时只标记“状态待确认”。
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
