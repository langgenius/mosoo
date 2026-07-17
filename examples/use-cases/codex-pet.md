# Codex Pet — Agent as API

Codex Pet shows how a workflow built in a coding IDE can become a reusable Mosoo-managed Agent exposed through an API.

A builder publishes a Pet Agent with an avatar-generation skill, then copies its generated **Instruction for LLM** into Codex. Codex uses that instruction to integrate the Mosoo Thread API into an existing product backend. The finished app accepts one avatar and returns a validated ZIP containing all nine Codex Pet animation states.

```text
publish Agent -> copy Instruction for LLM -> integrate from Codex
              -> upload avatar -> run Agent -> download pet ZIP
```

Explore the [implementation](https://github.com/Yevanchen/mosoo-codex-pet) or [watch the 57-second Agent as API video](https://github.com/Yevanchen/mosoo-codex-pet/blob/9662d6a93893816ddf8e01d6fbce7fb15cf08188/docs/assets/mosoo-agent-as-api.mp4).
