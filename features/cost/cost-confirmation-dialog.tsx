/** Explicit user consent before a version is finalized or submitted to DRB. */
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { formatSgd } from '@/lib/formatters';
import type { CostConfirmationDetails } from './cost-confirmation';

export function CostConfirmationBody({
  details,
  action,
  busy,
  error,
  onConfirm,
  onCancel,
  onViewCost,
}: {
  details: CostConfirmationDetails;
  action: string;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
  onViewCost: () => void;
}) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt>项目</dt>
        <dd>
          {details.projectName} · {details.projectId}
        </dd>
        <dt>成本版本</dt>
        <dd className="font-semibold">{details.versionCode}</dd>
        <dt>计算后总成本</dt>
        <dd className="font-semibold">{formatSgd(details.totalCost)}</dd>
        <dt>总人天</dt>
        <dd>{details.totalMandays.toLocaleString('en-SG')} MD</dd>
      </dl>
      <p className="text-sm">
        确认后仅将成本 {details.versionCode}{' '}
        定稿，不能再修改本版成本；后续变化请新建版本。{action}
        。此操作不会替代公司的评审结果。
      </p>
      {details.issues.length > 0 && (
        <ul className="max-h-40 overflow-auto text-sm">
          {details.issues.map((issue, index) => (
            <li
              key={index}
              className={
                issue.severity === 'error' ? 'text-red-700' : 'text-amber-800'
              }
            >
              {issue.severity === 'error' ? '需修正' : '请核对'}：
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="outline" disabled={busy} onClick={onViewCost}>
          查看成本
        </Button>
        <Button
          disabled={busy || details.errors.length > 0}
          onClick={onConfirm}
        >
          {busy ? '正在保存…' : '确认成本并继续'}
        </Button>
      </div>
    </div>
  );
}
export function CostConfirmationDialog(
  props: React.ComponentProps<typeof CostConfirmationBody> & { open: boolean },
) {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !props.busy) props.onCancel();
      }}
    >
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>请先确认本版成本</AlertDialogTitle>
          <AlertDialogDescription>
            核对项目、版本及金额后再继续。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <CostConfirmationBody {...props} />
      </AlertDialogContent>
    </AlertDialog>
  );
}
