import type { DailyDigest } from '../agent/digest-domain.ts';

export type Scene = {
  id: string;
  name: string;
  tone: string;
  maxItems: number;
  maxExcerptChars: number;
  missing: 'blank' | 'pending';
  requiredFields: ('title' | 'detail' | 'projectId' | 'severity')[];
  sections: { id: string; title: string; instruction: string }[];
  leads: string[];
  examples: string;
  adjustment: string;
};
export type SceneRecord = { scene: Scene; revision: number };
export type AiOutput = {
  sections: {
    id: string;
    entries: { sourceId: string; lead: string; excerpt: string }[];
  }[];
};
export type AiRun = {
  id: string;
  parentId: string | null;
  createdAt: string;
  snapshot: DailyDigest;
  scene: Scene;
  sceneRevision: number;
  model: string;
  provider: string;
  adjustment: string;
  result: AiOutput | null;
  status: 'draft' | 'failed' | 'confirmed';
  error?: string;
  final?: AiOutput;
  finalNote?: string;
  confirmedAt?: string;
};
