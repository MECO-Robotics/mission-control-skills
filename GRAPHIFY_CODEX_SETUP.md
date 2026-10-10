# Graphify setup for Codex

Use these instructions in any repository where Codex should use Graphify for low-token codebase context.

## Install

```bash
if command -v uv >/dev/null 2>&1; then
  uv tool install --upgrade graphifyy
else
  python3 -m pip install --user --upgrade graphifyy
fi
```

Verify the installation:

```bash
graphify --help
```

## Build the project graph

From the project root, run:

```bash
graphify extract . --mode deep --no-viz
```

For later changes, use the incremental form:

```bash
graphify extract . --mode deep --no-viz
```

Graphify writes the persistent graph under `graphify-out/`.

## Codex routing rule

When `graphify-out/graph.json` exists, every LLM and subagent must query Graphify before reading repository source for a codebase question:

```bash
graphify query "<question>"
graphify path "<concept A>" "<concept B>"
graphify explain "<concept>"
```

Use the returned scoped graph as the initial context. Read raw files only when the graph result is insufficient, when implementing the requested change, or when auditing Graphify output. Do not preload full reports, indexes, or source trees when a Graphify query can narrow the context.

This applies equally to web, backend, mobile, infrastructure, and shared packages.

## Two GPU local inference

For local semantic extraction with two GPUs, run one independent `llama-server` instance per GPU. Do not layer-split one model across both GPUs. Set these variables for the host before starting the servers:

```bash
MODEL=/absolute/path/to/gemma-4-26B-A4B-it-qat-UD-Q4_K_XL.gguf
MTP=/absolute/path/to/mtp-gemma-4-26B-A4B-it-Q4_0.gguf
MMPROJ=/absolute/path/to/mmproj-BF16.gguf
SERVER=/absolute/path/to/llama-server
HOST=127.0.0.1
RELAY_HOST=127.0.0.1

setsid "$SERVER" -m "$MODEL" --mmproj "$MMPROJ" --device Vulkan0 \
  --split-mode none -ngl 999 -c 16384 -np 1 \
  --cache-type-k q4_0 --cache-type-v q4_0 \
  --model-draft "$MTP" --spec-type draft-mtp --device-draft Vulkan0 --gpu-layers-draft 999 \
  --cache-type-k-draft q4_0 --cache-type-v-draft q4_0 \
  --reasoning off --temp 0 --seed 42 --host "$HOST" --port 8083 \
  >/tmp/graphify-gpu0.log 2>&1 < /dev/null &

setsid "$SERVER" -m "$MODEL" --mmproj "$MMPROJ" --device Vulkan1 \
  --split-mode none -ngl 999 -c 16384 -np 1 \
  --cache-type-k q4_0 --cache-type-v q4_0 \
  --model-draft "$MTP" --spec-type draft-mtp --device-draft Vulkan1 --gpu-layers-draft 999 \
  --cache-type-k-draft q4_0 --cache-type-v-draft q4_0 \
  --reasoning off --temp 0 --seed 42 --host "$HOST" --port 8084 \
  >/tmp/graphify-gpu1.log 2>&1 < /dev/null &
```

Send requests through a round-robin OpenAI-compatible relay at port 8085 so concurrent Graphify chunks use both instances. Configure the relay to forward to `${HOST}:8083` and `${HOST}:8084`; Graphify should address only `${RELAY_HOST}:8085`. The relay must set `response_format={"type":"json_object"}` for llama.cpp structured extraction. Keep `temperature=0` and `seed=42` for repeatable extraction. Use `--max-concurrency 4` for normal throughput; reduce it to `2` or `1` if either server becomes unstable. A 32,768-token context and per-chunk budget is the hardware maximum validated on this host:

```bash
OPENAI_API_KEY=local \
OPENAI_BASE_URL="http://${RELAY_HOST}:8085/v1" \
OPENAI_MODEL="$MODEL" \
graphify extract . --backend openai --model "$MODEL" \
  --mode deep --token-budget 16000 --max-concurrency 4 \
  --api-timeout 900 --no-cluster --no-viz
```

If the local llama.cpp build rejects the larger completion budget with HTTP
400, retry with `--token-budget 1024 --max-concurrency 1`. This fallback was
verified against the two-GPU relay and still refreshes the semantic cache;
increase the budget only after confirming the server's context and output
limits.

Verify both servers before starting a long run:

```bash
curl -sf "http://${HOST}:8083/health"
curl -sf "http://${HOST}:8084/health"
pgrep -af 'llama-server.*808[34]'
```

For a remote GPU host, set `HOST` and `RELAY_HOST` to its reachable address. Keep those values in the shell environment; do not commit them to the repository. The two server health checks must pass before starting extraction. After a code-only change, use `graphify update . --no-cluster`; after semantic changes, rerun the relay-backed command so changed document, paper, and image files are re-extracted from the semantic cache.

## AGENTS.md snippet

Add this under the project instructions:

```md
## Graphify context routing

When `graphify-out/graph.json` exists, all LLMs and subagents must use Graphify before reading source files for codebase questions. Run `graphify query "<question>"` for broad context, `graphify path "<A>" "<B>"` for relationships, and `graphify explain "<concept>"` for focused concepts. Treat the scoped result as initial context and read raw files only when it is insufficient or the task explicitly audits Graphify output. This applies to web, backend, mobile, infrastructure, and shared code.
```

## Rebuild and audit

Rebuild after substantial source changes or when the graph is stale:

```bash
graphify extract . --mode deep --no-viz
```

Use Graphify output itself for audits:

```bash
graphify diagnose multigraph
graphify god-nodes --top 20
graphify query "<audit question>"
```

## Keep generated Graphify output local

Ignore the entire `/graphify-out/` directory. Graphs, manifests, reports, compressed
exports and caches are generated context, not repository source. Regenerate them
locally with the extraction commands above; do not force-add them to Git or
compress them merely to publish them in the repository.

Check the rule and tracked files:

```bash
git check-ignore --no-index graphify-out/graph.json
git ls-files graphify-out/
```

The second command should print nothing. If a repository already tracks generated
output, remove it from the index while retaining local files:

```bash
git rm --cached -r graphify-out/
git add .gitignore
git diff --cached --check
```

Commit ignore rules and documentation through the normal review flow. Removing
files from the index does not remove them from earlier commits; an oversized
historical blob can still block pushing an old branch.
