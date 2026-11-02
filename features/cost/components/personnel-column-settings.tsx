import { Text, Surface } from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
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
      <Text as="p" tone="muted" textRole="body-small">
        List order matches the table from left to right. Each year field can
        move independently.
      </Text>
      <Surface
        as="div"
        variant="body"
        className="max-h-[min(55vh,420px)] space-y-1 overflow-y-auto"
      >
        {preferences.order.map((id, index) => {
          const spec = getPersonnelColumnSpec(id);
          const checked = !preferences.hidden.includes(id);
          const lastData =
            checked && visibleData.length === 1 && visibleData[0] === id;
          return (
            <Surface
              key={id}
              as="div"
              variant={checked ? 'inset' : 'plain'}
              tone={'inherit'}
              className="flex min-w-0 items-center gap-2"
            >
              <Surface
                as="label"
                variant="inline-field"
                textRole="body-small"
                className="flex min-w-0 flex-1 items-center"
              >
                <CheckInput
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
              </Surface>
              {id === 'action' ? (
                <Text as="span" tone="muted" textRole="body-small">
                  Fixed
                </Text>
              ) : (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"

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
            </Surface>
          );
        })}
      </Surface>
      <Surface
        as="div"
        variant="footer"
        className="flex items-center justify-between"
      >
        <Text as="span" tone="muted" textRole="body-small">
          {storageAvailable
            ? 'Use Save to keep this version’s layout in this browser.'
            : 'Browser storage unavailable; preferences apply to this view.'}
        </Text>
        <Button
          type="button"
          variant="outline"
          size="sm"

          disabled={!ready}
          onClick={() => {
            if (ready) onReset();
          }}
        >
          <RotateCcw className="size-3" />
          Reset
        </Button>
      </Surface>
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
            className="gap-1"
            disabled={props.ready === false}
          />
        }
      >
        <Columns3 className="size-3" />
        Columns
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(360px,90vw)]">
        <PopoverTitle>Cost Columns</PopoverTitle>
        <PopoverDescription>
          Show, hide or reorder columns. Simple Export follows this layout.
        </PopoverDescription>
        <PersonnelColumnSettingsPanel {...props} />
      </PopoverContent>
    </Popover>
  );
}
