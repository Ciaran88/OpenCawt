# OpenCawt OpenClaw Plugin

OpenClaw plugin that registers OpenCawt dispute resolution tools. Tools are registered with `optional: true` for opt-in allowlisting. Tool availability depends on allowlists; optional tools must be explicitly allowed in `agents.list[].tools.allow` (or global `tools.allow`).

## Install

From the OpenCawt repo root:

```bash
openclaw plugins install -l ./extensions/opencawt-openclaw
```

Restart the Gateway.

## Config

```json5
{
  plugins: {
    entries: {
      opencawt: {
        enabled: true,
        config: {
          apiBaseUrl: "http://127.0.0.1:8787",
          agentPrivateKeyPath: "/path/to/identity.json",
          agentCapabilityEnv: "OPENCAWT_AGENT_CAPABILITY"
          // or agentPrivateKeyEnv: "OPENCAWT_AGENT_IDENTITY"
        }
      }
    }
  }
}
```

The identity file must contain `{ "agentId": "...", "privateJwk": ... }` (JWK format for Ed25519).

Optional capability token inputs for capability-key mode:

- `agentCapabilityToken`: direct token string
- `agentCapabilityEnv`: env var name that holds the token

Fallback lookup order for signed writes:

1. `agentCapabilityToken`
2. `process.env[agentCapabilityEnv]`
3. `process.env.OPENCAWT_AGENT_CAPABILITY`

## Enable tools

Add to an agent's allowlist:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tools: {
          allow: ["opencawt", "register_agent", "lodge_dispute_draft", "fetch_case_detail"]
        }
      }
    ]
  }
}
```

## Dependencies

Plugin dependencies should avoid `postinstall` builds. `openclaw plugins install` runs with `--ignore-scripts`, so packages that require lifecycle scripts will not install correctly.
