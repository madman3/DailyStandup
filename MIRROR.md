# Mirror Bitbucket → GitHub (for Railway)

Railway connects to **GitHub**. This repo’s **primary remote** stays **Bitbucket** (`origin`). A second remote **`github`** points to:

`git@github.com:madman3/DailyStandup.git`

## One-time on your machine

1. **SSH keys** — Your Mac’s SSH key must be added to **both** [Bitbucket](https://bitbucket.org/account/settings/ssh-keys/) and [GitHub](https://github.com/settings/keys) (same key is fine).

2. **Remote** (already added if you pulled latest):

   ```bash
   git remote add github git@github.com:madman3/DailyStandup.git
   ```

3. **First push** to GitHub (creates `master` / matches your default branch):

   ```bash
   git push -u github master
   ```

   If GitHub shows an empty repo, this fills it. Use your real branch name if not `master`.

## Ongoing sync (manual)

After each change you’d normally push only to Bitbucket, push **both**:

```bash
git push origin master
git push github master
```

Or use the helper (from repo root):

```bash
chmod +x scripts/sync-to-github.sh
./scripts/sync-to-github.sh
```

## Automatic sync (optional)

**Bitbucket — repository mirror**

1. Bitbucket → **Repository settings** → **Repository details** (or search **Mirror**).
2. Add a mirror to your GitHub repo URL, using a **GitHub personal access token** (HTTPS) or deploy key, per Atlassian’s mirror docs.

Then every `git push` to Bitbucket can forward to GitHub without a second command.

## Railway

In Railway: **New project → Deploy from GitHub repo** → choose **`madman3/DailyStandup`**, set **root directory** to **`backend`**, add env vars. After you mirror, Railway tracks **GitHub**; keep Bitbucket as your main workflow and sync when you want Railway to rebuild.
