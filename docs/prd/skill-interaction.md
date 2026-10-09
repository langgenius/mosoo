# Skills

How a Project adds Skills, attaches them to Agents, and what happens when one is removed.

## Promises

- A Skill is added from a `.md`, `.zip` or `.skill` upload, a GitHub repository, or skills.sh, with a preview of its name, description and author before it is saved.
- Skills belong to one Project. The owner manages them in the console; a Project API key can attach a Skill of its own Project by ID when it saves an Agent preset. A new Session gets the Skills its Agent has attached.
- **Fork** makes an independent copy in the same Project. It does not follow later changes, and deleting the source leaves it intact.
- Uninstalling a Skill keeps admitted Sessions unchanged. Agents show it as **Missing**, new Sessions skip it with the warning `skill.tombstone`, and saving the Agent drops the attachment.

## Limits

- No in-app editor and no update action: revise a Skill locally, add it again, and reattach it.
- No sharing across Projects and no catalog. Uninstalling does not list the affected Agents.
- An upload is at most `MAX_SKILL_UPLOAD_BYTES`. A GitHub import downloads the whole repository archive and fails when it exceeds `MAX_SKILL_UNCOMPRESSED_BYTES`, so a Skill in a large repository cannot be imported from GitHub.
