/** Loaded only after a browser container is mounted; no Univer runtime in SSR. */
import { createElement } from 'react';
import { createUniver, LocaleType } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import EnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import type { IWorkbookData } from '@univerjs/core';

export function mountUniver(
  container: HTMLElement,
  snapshot: Partial<IWorkbookData>,
  onChange: (snapshot: IWorkbookData) => void,
  onToolbarHost?: (host: HTMLDivElement | null) => void,
  hideProtectedShadows = false,
) {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: EnUS },
    presets: [
      UniverSheetsCorePreset({
        container,
        ...(hideProtectedShadows
          ? { sheets: { protectedRangeShadow: 'none' as const } }
          : {}),
      }),
    ],
  });
  const toolbarPart = onToolbarHost
    ? univerAPI.registerUIPart(univerAPI.Enum.BuiltInUIPart.HEADER_MENU, () =>
        createElement('div', { ref: onToolbarHost }),
      )
    : undefined;
  const workbook = univerAPI.createWorkbook(snapshot);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const capture = () => {
    if (!disposed) onChange(workbook.save());
  };
  const listener = univerAPI.addEvent(
    univerAPI.Event.CommandExecuted,
    ({ type }) => {
      if (type !== 2) return;
      clearTimeout(timer);
      timer = setTimeout(capture, 250);
    },
  );
  return {
    snapshot: () => workbook.save(),
    focusCell(sheetId: string, row = 1, column = 1) {
      const sheet = workbook.getSheetBySheetId(sheetId);
      if (sheet) {
        workbook.setActiveSheet(sheet);
        sheet.getRange(row - 1, column - 1).activate();
      }
    },
    async protectHeaders(sheetIds: string[]) {
      for (const id of sheetIds) {
        const sheet = workbook.getSheetBySheetId(id);
        if (sheet) {
          const permission = sheet.getRange('1:1').getRangePermission();
          const rules = permission.isProtected()
            ? await permission.listRules({ ignoreCollaborators: true })
            : [await permission.protect({ name: 'Fixed input headers' })];
          for (const rule of rules)
            await rule.setPoint(
              univerAPI.Enum.RangePermissionPoint.Edit,
              false,
            );
        }
      }
    },
    setReadOnly: (value: boolean) => workbook.setEditable(!value),
    async calculate() {
      await workbook.endEditingAsync(true);
      const formula = univerAPI.getFormula();
      const applied = formula.onCalculationResultApplied(15000);
      formula.executeCalculation();
      await applied;
      return workbook.save();
    },
    dispose() {
      clearTimeout(timer);
      capture();
      disposed = true;
      listener.dispose();
      toolbarPart?.dispose();
      univer.dispose();
    },
  };
}
export type UniverHandle = ReturnType<typeof mountUniver>;
