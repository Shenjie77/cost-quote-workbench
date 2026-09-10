/** Show/hide and left/right ordering are local view preferences, including on locked costs. */
import { ArrowLeft, ArrowRight, Columns3, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  getPersonnelColumnSpec,
  normalizePersonnelColumns,
  visiblePersonnelColumns,
  type PersonnelColumnId,
  type PersonnelColumnPreferences,
} from '../personnel-columns';

export type PersonnelColumnSettingsProps = {
  preferences: PersonnelColumnPreferences;
  onSetVisible: (id: PersonnelColumnId, visible: boolean) => void;
  onMove: (id: PersonnelColumnId, direction: 'left' | 'right') => void;
  onReset: () => void;
  ready?: boolean;
  storageAvailable?: boolean;
};

export function PersonnelColumnSettingsPanel({
  preferences: raw,
  onSetVisible,
  onMove,
  onReset,
  ready = true,
  storageAvailable = true,
}: PersonnelColumnSettingsProps) {
  const preferences = normalizePersonnelColumns(raw);
  const visibleData = visiblePersonnelColumns(preferences).filter(
    (id) => id !== 'action' && id !== 'check',
  );
  return (
    <div className="space-y-2" aria-label="Cost column settings">
      <p className="text-[11px] leading-4 text-muted-foreground">
        List order matches the table from left to right. Each year field can
        move independently.
      </p>
      <div className="max-h-[min(55vh,420px)] space-y-0.5 overflow-y-auto pr-1">
        {preferences.order.map((id, index) => {
          const spec = getPersonnelColumnSpec(id);
          const checked = !preferences.hidden.includes(id);
          const lastData =
            checked && visibleData.length === 1 && visibleData[0] === id;
          return (
            <div
              key={id}
              className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-1 ${checked ? 'bg-muted/35' : ''}`}
            >
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`Show ${spec.label} column`}
                  checked={checked}
                  disabled={!ready || !spec.hideable || lastData}
                  title={
                    lastData
                      ? 'Keep at least one data column visible.'
                      : undefined
                  }
                  onChange={(event) => {
                    if (ready && spec.hideable && !lastData)
                      onSetVisible(id, event.target.checked);
                  }}
                />
                <span className="truncate">{spec.label}</span>
              </label>
              {id === 'action' ? (
                <span className="text-[10px] text-muted-foreground">Fixed</span>
              ) : (
                <div className="flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Move ${spec.label} left`}
                    title="Move left"
                    disabled={!ready || index === 0}
                    onClick={() => {
                      if (ready && index > 0) onMove(id, 'left');
                    }}
                  >
                    <ArrowLeft className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Move ${spec.label} right`}
                    title="Move right"
                    disabled={!ready || index >= preferences.order.length - 2}
                    onClick={() => {
                      if (ready && index < preferences.order.length - 2)
                        onMove(id, 'right');
                    }}
                  >
                    <ArrowRight className="size-3" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="text-[10px] text-muted-foreground">
          {storageAvailable
            ? 'Use Save to keep this version’s layout in this browser.'
            : 'Browser storage unavailable; preferences apply to this view.'}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-2.5 text-xs"
          disabled={!ready}
          onClick={() => {
            if (ready) onReset();
          }}
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      </div>
    </div>
  );
}

export function PersonnelColumnSettings(props: PersonnelColumnSettingsProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 text-xs"
            disabled={props.ready === false}
          />
        }
      >
        <Columns3 className="size-3" />
        Columns
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(360px,90vw)]">
        <PopoverTitle>Cost Columns</PopoverTitle>
        <PopoverDescription className="text-[11px]">
          Show, hide or reorder columns. Simple Export follows this layout.
        </PopoverDescription>
        <PersonnelColumnSettingsPanel {...props} />
      </PopoverContent>
    </Popover>
  );
}
