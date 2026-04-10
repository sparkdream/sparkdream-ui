---
name: commit-message
description: Draft a short commit message for staged changes without committing. Use when the user says "commit message", "draft commit message", or wants to preview a commit message.
---

# Draft Commit Message

Analyze staged git changes and produce a short, descriptive commit message **without** creating a commit.

## Steps

### 1. Check for staged changes

```bash
git diff --cached --stat
```

If there are no staged changes, tell the user "No staged changes found" and stop.

### 2. Read the staged diff

```bash
git diff --cached
```

### 3. Read recent commit messages for style reference

```bash
git log --oneline -10
```

### 4. Draft the commit message

Analyze the staged diff and write a concise commit message (1-2 sentences) that:
- Summarizes the **why** not just the **what**
- Matches the style/conventions of recent commits
- Is under ~72 characters for the subject line when possible

### 5. Present the message to the user

Show the draft commit message. Do **not** run `git commit`. The user handles all version control.
