import { randomUUID } from 'node:crypto';
import { buildDailyDigest } from '../features/agent/digest-domain.ts';
import {
  buildMessages,
  validateScene,
  validateOutput,
  outputSchema,
} from './ai-output-domain.mjs';
import { ModelError, publicModelConfig } from './model-service.mjs';

export function createAiOutputRouter({ store, repository, service }) {
  let generating = false;
  return async ({ request, response, url, respond, readJson, origin }) => {
    if (!url.pathname.startsWith('/api/local/ai-output/')) return false;
    const route = url.pathname.slice('/api/local/ai-output/'.length);
    try {
      let data;
      if (route === 'settings' && request.method === 'GET')
        data = publicModelConfig(service.config);
      else if (route === 'probe' && request.method === 'POST')
        data = await service.probe();
      else if (route === 'scenes' && request.method === 'GET')
        data = store.scenes();
      else if (route === 'scenes' && request.method === 'PUT') {
        const body = await readJson(request);
        data = store.saveScene(body.scene, body.expectedRevision);
      } else if (route === 'runs' && request.method === 'GET')
        data = store.recent();
      else if (route === 'export' && request.method === 'GET') {
        response.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition':
            'attachment; filename="daily-digest-feedback.jsonl"',
          'Cache-Control': 'no-store',
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        });
        for (const line of store.exportLines()) {
          if (response.destroyed) break;
          if (!response.write(line))
            await new Promise((resolve) => {
              const done = () => {
                response.off('drain', done);
                response.off('close', done);
                resolve();
              };
              response.once('drain', done);
              response.once('close', done);
            });
        }
        response.end();
        return true;
      } else if (route === 'confirm' && request.method === 'POST') {
        const body = await readJson(request);
        data = store.confirm(body.id, body.final, body.note);
      } else if (route === 'generate' && request.method === 'POST') {
        if (generating)
          throw new ModelError(
            'MODEL_BUSY',
            'Another generation is running. Wait before retrying.',
            409,
          );
        generating = true;
        try {
          const body = await readJson(request);
          const selected = store.scene(body.sceneId);
          if (selected.revision !== body.sceneRevision)
            throw new ModelError(
              'SCENE_CONFLICT',
              'Scene changed. Reload it before generating.',
              409,
            );
          const scene = validateScene(body.scene || selected.scene);
          if (scene.id !== selected.scene.id)
            throw new TypeError('Scene ID does not match.');
          if (
            typeof body.adjustment !== 'string' ||
            body.adjustment.length > 500
          )
            throw new TypeError('Adjustment must be at most 500 characters.');
          let snapshot, parent;
          if (body.parentId) {
            parent = store.run(body.parentId);
            if (!parent.result)
              throw new TypeError('Cannot revise a failed generation.');
            if (parent.scene.id !== scene.id)
              throw new TypeError('Start a new draft when changing scene.');
            snapshot = parent.snapshot;
          } else {
            const projects = repository.list();
            const digest = buildDailyDigest(
              projects,
              projects.flatMap((p) => p.reviewGates || []),
            );
            if (
              !Array.isArray(body.sourceIds) ||
              body.sourceIds.length > 30 ||
              body.sourceIds.some((id) => typeof id !== 'string') ||
              new Set(body.sourceIds).size !== body.sourceIds.length
            )
              throw new TypeError('Select at most 30 unique source items.');
            const ids = new Set(body.sourceIds);
            if (
              body.sourceIds.some(
                (id) => !digest.items.some((i) => i.id === id),
              )
            )
              throw new TypeError(
                'Source data changed. Refresh Today before generating.',
              );
            if (digest.items.length && !ids.size)
              throw new TypeError('Select source items before generating.');
            snapshot = {
              ...digest,
              items: digest.items.filter((i) => ids.has(i.id)),
            };
          }
          const run = {
            id: randomUUID(),
            parentId: parent?.id || null,
            createdAt: new Date().toISOString(),
            snapshot,
            scene,
            sceneRevision: selected.revision,
            model: service.config.model,
            provider: service.config.provider,
            modelSettings: publicModelConfig(service.config),
            adjustment: body.adjustment,
            result: null,
            status: 'draft',
          };
          try {
            run.result = validateOutput(
              await service.generate(
                buildMessages(
                  scene,
                  snapshot,
                  body.adjustment,
                  parent?.final || parent?.result,
                ),
                outputSchema,
              ),
              scene,
              snapshot,
            );
          } catch (error) {
            run.status = 'failed';
            run.error =
              error instanceof ModelError ? error.code : 'MODEL_FORMAT';
            store.writeRun(run);
            if (error instanceof ModelError) throw error;
            throw new ModelError(
              'MODEL_FORMAT',
              'Model output failed source/structure validation. Previous content is retained. Retry or use the original digest.',
            );
          }
          store.writeRun(run);
          data = run;
        } finally {
          generating = false;
        }
      } else {
        respond(404, {
          ok: false,
          error: { message: 'AI endpoint not found.' },
        });
        return true;
      }
      respond(200, { ok: true, data });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      respond(error.status, {
        ok: false,
        error: { code: error.code, message: error.message },
      });
    }
    return true;
  };
}
