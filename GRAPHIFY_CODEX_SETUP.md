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

For local semantic extraction with two GPUs, run one independent `llama-server` instance per GPU. Do not layer-split one model across both GPUs. The following host configuration uses Gemma 4 26B IQ4_XS and the Vulkan devices exposed as `Vulkan0` and `Vulkan1`:

```bash
MODEL=/home/brian/models/gemma4-26b-a4b/gemma-4-26B-A4B-it-UD-IQ4_XS.gguf
MMPROJ=/home/brian/models/gemma4-26b-a4b/mmproj-gemma-4-26B-A4B-it-BF16.gguf
SERVER=/home/brian/runtime/llama-vulkan-b10677/llama-b10677/llama-server
HOST=100.121.248.52

setsid "$SERVER" -m "$MODEL" --mmproj "$MMPROJ" --device Vulkan0 \
  --split-mode none -ngl 999 -c 16384 -np 1 \
  --reasoning off --temp 0 --seed 42 --host "$HOST" --port 8083 \
  >/tmp/graphify-gpu0.log 2>&1 < /dev/null &

setsid "$SERVER" -m "$MODEL" --mmproj "$MMPROJ" --device Vulkan1 \
  --split-mode none -ngl 999 -c 16384 -np 1 \
  --reasoning off --temp 0 --seed 42 --host "$HOST" --port 8084 \
  >/tmp/graphify-gpu1.log 2>&1 < /dev/null &
```

Send requests through a round-robin OpenAI-compatible relay at port 8085 so concurrent Graphify chunks use both instances. Keep `temperature=0` and `seed=42` for repeatable extraction. Use `--max-concurrency 4` for normal throughput; reduce it to `2` or `1` if either server becomes unstable. A 16,000-token per-chunk budget is a useful high-quality setting:

```bash
OPENAI_API_KEY=local \
OPENAI_BASE_URL=http://100.121.248.52:8085/v1 \
OPENAI_MODEL="$MODEL" \
graphify extract . --backend openai --model "$MODEL" \
  --mode deep --token-budget 16000 --max-concurrency 4 \
  --api-timeout 900 --no-cluster --no-viz
```

Verify both servers before starting a long run:

```bash
curl -sf http://100.121.248.52:8083/health
curl -sf http://100.121.248.52:8084/health
pgrep -af 'llama-server.*808[34]'
```

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

## Git operations for Graphify artifacts

Keep Graphify changes in a dedicated worktree and feature branch. Do not edit the base checkout:

```bash
git fetch origin development
git worktree add -b feature/graphify-update ../graphify-update origin/development
cd ../graphify-update
```

After extraction, commit the shareable artifacts together:

```bash
git add GRAPHIFY_CODEX_SETUP.md graphify-out/graph.json \
  graphify-out/manifest.json graphify-out/.graphify_labels.json \
  graphify-out/.graphify_analysis.json graphify-out/GRAPH_REPORT.md
git diff --cached --check
git commit -m "docs: update Graphify artifacts"
```

Before committing, remove host-specific details. Source paths in `graph.json` should be relative to the project root. Do not commit API keys, model paths, IP addresses, relay logs, semantic caches, backups, HTML exports, or temporary sidecars.

GitHub rejects files over 100 MB. If `graph.json` exceeds that limit and Git LFS is unavailable, compress it and include a short README:

```bash
gzip -c graphify-out/graph.json > graphify-out/graph.json.gz
rm graphify-out/graph.json
printf '%s\n' 'Decompress graph.json.gz before running graphify query.' > graphify-out/README.md
```

Push the feature branch, then merge it into `development` through the repository's normal review flow:

```bash
git push -u origin feature/graphify-update
git fetch origin development
git switch development
git merge --no-ff feature/graphify-update
git push origin development
```

Verify the remote branch and artifact paths after pushing:

```bash
git fetch origin development
git rev-parse origin/development
git status --short
```
