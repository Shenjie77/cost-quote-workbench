import { WorkbenchApp } from '@/features/workbench/workbench-app';

/** App Router entry point; all interactive state lives in the client workbench. */
export default function Home() {
  return <WorkbenchApp />;
}
