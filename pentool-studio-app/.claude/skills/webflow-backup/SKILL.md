---
name: webflow-backup
description: Ask the user to create a Webflow restore point before any build, and record their answer. Use at the start of every session, before building, or whenever the user asks about backups or whether it is safe to build.
---

# Ask for a Webflow restore point

**Webflow has no undo API and no backups endpoint.** Nothing in this project can
create a backup, restore one, or check whether one exists. Only a human, in the
Designer, can make a restore point — and it is the only thing that can put the
site back after a bad build.

So this skill asks. It does not verify, because it cannot.

## 1. Ask

Ask once, plainly, and stop:

> Before I build, make a restore point in Webflow: open the Designer →
> **Settings → Backups → Create backup**. That is the only thing that can undo a
> bad build — I cannot make one or check for one.
>
> Say **done** when it exists, or **skip** to build without one.

## 2. Wait for a real answer

**Never answer on the user's behalf.** Do not assume, do not infer from silence,
and do not record "confirmed" because a backup seems likely or because one was
made in an earlier session. A backup from yesterday is not a backup for today's
build. If the reply is ambiguous, ask again rather than guessing.

## 3. Record it

```bash
node bin/wf-backup.js confirm                  # they said done
node bin/wf-backup.js skip "in a hurry"        # they said skip
```

Either answer unblocks the build. The difference is what gets said afterwards.

## 4. Say where that leaves them

- **confirmed** — say the restore point is theirs to use in the Designer if the
  build goes wrong. Do not imply this project can restore it.
- **skipped** — say plainly, once, that this session has no way back, and that
  anything the build writes will have to be undone by hand. Then continue. Do
  not repeat it every section.

## What this is not

Never call `/webflow-snapshot` a backup, and never offer it as one. A snapshot is
a JSON record of pages, styles and element trees — useful for seeing *what
changed*, and incapable of changing anything back. Someone who loses work
believing a snapshot had them covered was misled by us.
