# Project rules

## Merge every PR after you open it

After you open a PR in this repo, merge it without asking:

```
gh pr merge <number> --squash --delete-branch
```

- Run `node --test` before you open the PR. If a test fails, fix it first. Do not merge a PR with failing tests.
- If the PR has checks, wait until they pass, then merge. If a check fails, fix the cause and push. Do not merge while a check is red.
- If `gh pr merge` reports a conflict, rebase the branch on `origin/main`, run `node --test`, push, and merge again.
- After the merge, run `git switch main && git pull` so the local `main` matches GitHub.
