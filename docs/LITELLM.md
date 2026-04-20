# Using OVO with LiteLLM

OVO exposes an OpenAI-compatible API at `http://localhost:11436/v1`, which works as a drop-in provider for [LiteLLM](https://github.com/BerriAI/litellm).

## Quick Start

### 1. Start OVO and load a model

Launch OVO, go to **Models**, and download/select a model (e.g., `mlx-community/gemma-3-4b-it-qat-4bit`).

### 2. Configure LiteLLM

Add OVO as a custom OpenAI provider in your `litellm_config.yaml`:

```yaml
model_list:
  - model_name: ovo-local
    litellm_params:
      model: openai/mlx-community/gemma-3-4b-it-qat-4bit
      api_base: http://localhost:11436/v1
      api_key: not-needed
```

### 3. Use via LiteLLM Python SDK

```python
import litellm

response = litellm.completion(
    model="openai/mlx-community/gemma-3-4b-it-qat-4bit",
    api_base="http://localhost:11436/v1",
    api_key="not-needed",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### 4. Use via LiteLLM Proxy

```bash
litellm --config litellm_config.yaml
```

Then point any OpenAI-compatible client at `http://localhost:4000`.

## Available Models

Query the models endpoint to see all loaded models:

```bash
curl http://localhost:11436/v1/models
```

## Streaming

Streaming is fully supported:

```python
response = litellm.completion(
    model="openai/mlx-community/gemma-3-4b-it-qat-4bit",
    api_base="http://localhost:11436/v1",
    api_key="not-needed",
    messages=[{"role": "user", "content": "Write a haiku"}],
    stream=True,
)
for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

## Supported Endpoints

| Endpoint | Status |
|----------|:------:|
| `/v1/models` | ✅ |
| `/v1/chat/completions` | ✅ |
| `/v1/completions` | ✅ |
| `/v1/embeddings` | Planned |

## Ollama API

OVO also exposes an Ollama-compatible API at `http://localhost:11435`:

```bash
curl http://localhost:11435/api/tags
curl http://localhost:11435/api/chat -d '{"model":"...","messages":[...]}'
```

## Troubleshooting

- **Connection refused**: Make sure OVO is running and a model is loaded.
- **Model not found**: Use the exact model ID from `/v1/models`.
- **Slow first response**: First inference after model load includes warmup. Subsequent calls are faster.
