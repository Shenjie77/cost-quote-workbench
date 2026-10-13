# Local model output experiment (Today)

The first pilot is **Today / Daily Digest**. The existing deterministic cards
remain available. The model chooses chapters, order, source excerpts and approved
lead phrases; platform rules compute reminders, SLA, severity, costs and dates.
This is inference only: no pretraining, LoRA, automatic learning, downloads or paid
service is activated.

## Architecture and trust boundaries

Browser → existing loopback Node API (`127.0.0.1:3210`) → model service.
SQLite `data/workbench.sqlite` stores independent `ai_output_scenes` and
`ai_output_runs` tables. No project schema or pricing calculation changes.

The model address is relative to the **Node backend's machine**, not the browser,
web worker or cloud host. Localhost on different machines refers to different
computers. Run the UI and Node API locally on the working computer. A cloud or
remote preview does not automatically connect to a workstation model; the panel
asks for an explicit backend address when the page host is not loopback. Current
API CORS permits only `http://localhost:3000` and `http://127.0.0.1:3000`. Do not
expose the unauthenticated local API on a company network. This pilot does not
add remote authentication or change the existing platform's local deployment.

API keys come only from backend environment variables; never use a `VITE_*`,
`NEXT_PUBLIC_*`, browser storage or scene field for keys. The UI shows model name
and limits, but neither service address nor key. Errors discard model service
response bodies and network exception details; neither is logged or exported.

System instructions and JSON input use separate message roles. Examples,
project notes and adjustment requests cannot change the platform validator.
Source IDs must exist, chapters must match configuration, source references
cannot repeat, limits must hold, and all model excerpts must be exact contiguous
source text. Thus this first pilot supports **extractive editing**, not arbitrary
factual paraphrasing. User-authored lead phrases and manually edited final text
are user input: review these against the displayed source facts. The validator
cannot verify a user's manually supplied prose. AI never modifies facts in the
source cards. Free prose generation can be evaluated in a later pilot.

## Platform prerequisites (both operating systems)

Use Node **22.18+** and the existing npm toolchain:

```text
npm ci
npm run seed:local
npm run dev
```

Open `http://localhost:3000`. `npm run build` then `npm start` is the built local
mode. Existing launchers now invoke JavaScript CLI entrypoints with Node instead
of POSIX `.bin` symlinks, so they do not require bash or Windows `.cmd` spawning.
Data and environment paths use `node:path`; no OS-specific shell is used by AI.
The platform starts without a running model and all original functions work.
Even invalid AI settings are checked lazily when the experiment is used.

## Backend settings

Create an ignored **`.env.ai.local`** file at the project root. The Node API loads
it automatically on startup (existing process environment takes precedence).
Do not commit this file or your SQLite database. Restart `npm run dev` / `npm
start` after changing settings.

Example for Ollama (replace model with the exact tag actually installed):

```dotenv
WORKBENCH_AI_PROVIDER=ollama
WORKBENCH_AI_BASE_URL=http://127.0.0.1:11434
WORKBENCH_AI_MODEL=your-installed-qwen3-4b-instruct-2507-q4-tag
WORKBENCH_AI_TIMEOUT_MS=120000
WORKBENCH_AI_CONTEXT=4096
WORKBENCH_AI_MAX_TOKENS=768
# WORKBENCH_AI_API_KEY=optional-secret
```

No model is hardcoded or installed automatically. The initial candidate is
**Qwen3-4B-Instruct-2507, Q4_K_M / comparable 4-bit GGUF**. Verify the complete
model identity and quantization in the service before loading; generic `qwen3:4b`
may name a different checkpoint. Obtain only an approved distribution or import
a verified GGUF. The 16GB/i7-1360P workstation's actual speed and usable context
must be measured, especially with other corporate applications open.

### Ollama, macOS and Windows

Install Ollama yourself if needed. After explicitly choosing the approved model,
install/import it using Ollama's documented procedure. The app does not do this.
If using a verified GGUF, put this in a Modelfile with a relative filename:

```text
FROM ./Qwen3-4B-Instruct-2507-Q4_K_M.gguf
PARAMETER num_ctx 4096
PARAMETER num_predict 768
```

Then, from that folder (Terminal on macOS, PowerShell on Windows):

```text
ollama create workbench-qwen3-4b-instruct-2507-q4 -f Modelfile
ollama list
```

Set `WORKBENCH_AI_MODEL=workbench-qwen3-4b-instruct-2507-q4`. For a foreground
server, quit any already-running Ollama tray/menu application first to avoid a
port conflict. macOS Terminal:

```sh
OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
```

Windows PowerShell:

```powershell
$env:OLLAMA_NUM_PARALLEL="1"
$env:OLLAMA_MAX_LOADED_MODELS="1"
ollama serve
```

The adapter explicitly sends `num_gpu: 0`, `num_ctx` and bounded `num_predict`;
this pilot starts with CPU on both machines. Other Ollama clients may still
compete for resources, so avoid concurrent use during evaluation. `think: false`
is sent; use the intended Instruct checkpoint rather than a reasoning checkpoint.
See [Ollama API](https://docs.ollama.com/api/chat) and
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

### LM Studio / OpenAI-compatible

Install LM Studio yourself, load the verified Q4 GGUF, set GPU offload to **0**,
set model context to **4096**, and start its local server. Set:

```dotenv
WORKBENCH_AI_PROVIDER=openai-compatible
WORKBENCH_AI_BASE_URL=http://127.0.0.1:1234/v1
WORKBENCH_AI_MODEL=exact-model-id-from-server
WORKBENCH_AI_CONTEXT=4096
WORKBENCH_AI_MAX_TOKENS=768
WORKBENCH_AI_TIMEOUT_MS=120000
# WORKBENCH_AI_API_KEY=only-if-your-server-requires-it
```

`/v1/chat/completions` supplies `max_tokens` and JSON schema `response_format`.
OpenAI-compatible chat has no portable context-size or CPU-offload parameter:
set those on the server manually. The configured context is also the platform's
conservative admission limit. Providers without JSON schema support fail safely;
there is no fallback to unvalidated prose. See
[LM Studio structured output](https://lmstudio.ai/docs/developer/openai-compat/structured-output)
and [API comparison](https://lmstudio.ai/docs/developer/rest).

## Use

1. Open **Today → Open full digest / 完整摘要**, enable **Local AI draft experiment**, and click **Load
   configuration**. Default local API is `http://127.0.0.1:3210/api/local`.
2. Click **Check model connection**. It lists installed model IDs without
   generating content. Choose a scene and start with **one** source reminder.
   Inputs are reread from persisted SQLite, not accepted as arbitrary browser
   facts. Save/flush project edits first. Stale source IDs prompt a refresh.
3. Expand scene JSON to edit `name`, `sections` (order, titles and instructions),
   `tone`, `maxItems`, `maxExcerptChars`, `requiredFields`, `missing`, `leads`,
   `examples` and default `adjustment`. Limits are validated on the server.
4. **Generate new draft** uses the current configuration without saving it as a
   preset. Generated drafts persist independently. Enter adjustment requirements
   and use **Revise same snapshot** to create a linked revision, keeping the
   original source snapshot. An unsaved manual final edit is not sent as prior
   model output; confirm it first if it should become the revision baseline.
5. **Save as scene preset** saves configuration AND the adjustment field with an
   incremented version. Changing `id` saves a new scene; select it before generating.
   Concurrent preset updates are rejected rather than silently overwritten.
6. Edit draft lead/content, inspect **Source facts**, optionally open the source
   record, add final feedback, and **Confirm final version**. This only saves an
   accepted feedback record; it never writes workflow, cost, quote or formal
   project fields. Accepted records are immutable; regenerate to revise them.
7. Recent 20 records can be reopened after restart. **Export feedback JSONL**
   exports every record, including failed attempts, in the existing database.
   The JSONL includes snapshot, actual scene config, saved config revision,
   provider/model/limits, parent generation ID, adjustment, generated output,
   status, final accepted text and confirmation feedback. Config saved as a
   preset is reusable; unsaved generation config is recorded in that run.

Drafts are **historical snapshots**, not live workflow status. Full input facts
remain stored alongside selections. Because the 4K budget is conservative (UTF-8
prompt bytes + output tokens + margin), long input is rejected before inference,
never silently truncated. Reduce selected reminders/config examples first.
A provider-specific tokenizer is not installed, so this guard may reject prompts
that could fit. It is a resource guard, not a guarantee across all tokenizers.
No automatic map/reduce or multiple inference requests are made.

## Failures and rollback

- API unreachable: start `npm run dev` or `npm start`; verify local API port 3210,
  UI port 3000, browser origin, and that the platform is running on this computer.
- Model unreachable: verify from the backend machine; start Ollama/LM Studio,
  check base URL, Windows firewall rules, model load and exact model ID.
- 401/403: configure backend API key if required; do not put it in the UI.
- Busy: wait for the active request. Both UI and backend reject duplicates.
- Timeout: default two minutes; previous draft remains. A stopped browser may
  leave inference running until backend timeout, so wait before retrying.
- Context limit: select fewer items or shorten configuration/adjustment.
- JSON/schema/source validation failure or output truncation: retry, reduce
  input items, or use the original digest. Invalid output cannot be confirmed.
- Scene conflict: load latest configuration before saving/generating again.

Uncheck the experiment to return to the original output immediately. Remove AI
settings to disable generation. No project data needs rollback. SQLite backup
includes the new tables through the existing backup procedure. JSONL contains
business information; keep it in an approved local/internal location. There is
no scheduler, training pipeline or upload behind feedback collection.

## Validation scope

Automated tests exercise both protocols using mock responses and a real loopback
HTTP mock, normal generation, feedback revision, saved configuration/version
conflicts, confirmation, persistence/reopen, JSONL, unavailable service, complete
request/body timeout, bounded context/output, duplicate requests and invalid or
ungrounded output. TypeScript, lint, project tests and build are run for delivery.

macOS local verification is recorded in the delivery message. Windows has not
been physically tested: validate Node/npm install and build, process launch and
shutdown, SQLite persistence, Ollama or LM Studio CPU settings, actual latency,
timeout behavior, JSONL download and firewall behavior on the i7-1360P computer.
No inference speed/quality claims are made without running that model.
