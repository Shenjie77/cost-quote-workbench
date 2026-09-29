import { CalculationDraftPage } from '@/features/calculation/calculation-draft-page';
/** Standalone access also works before creating the first project. */
export default function CalculationsPage() {
  return (
    <main>
      <CalculationDraftPage standalone />
    </main>
  );
}
