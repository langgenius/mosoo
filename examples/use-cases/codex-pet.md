# Codex Pet — Agent as API

Codex Pet shows how a workflow built in a coding IDE can become a reusable Mosoo Agent in the cloud.

A builder publishes a Pet Agent with an avatar-generation skill, then copies its generated **Instruction for LLM** into Codex. Codex uses that instruction to integrate the Mosoo Thread API into an existing product backend. The finished app accepts one avatar and returns a validated ZIP containing all nine Codex Pet animation states.

```text
publish Agent -> copy Instruction for LLM -> integrate from Codex
              -> upload avatar -> run Agent -> download pet ZIP
```

The implementation and video walkthrough live in [Yevanchen/mosoo-codex-pet](https://github.com/Yevanchen/mosoo-codex-pet).
