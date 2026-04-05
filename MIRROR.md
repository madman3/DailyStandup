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

## Automatic sync (recommended): Bitbucket Pipelines

Every successful push to **`master`** on Bitbucket runs **`bitbucket-pipelines.yml`**, which:

1. Runs **`npm ci`** (CI).
2. **Pushes the same commit** to **`github.com/madman3/DailyStandup`** branch **`master`**.

**One-time setup**

1. GitHub → **Settings → Developer settings → Personal access tokens** → create a **classic** token with **`repo`** scope.
2. Bitbucket → **Repository settings → Repository variables** → add **`GITHUB_MIRROR_TOKEN`** (value = that token, **Secured**).
3. Push this repo to Bitbucket so the pipeline file is active.

If the mirror step fails with auth errors, regenerate the PAT and confirm the token can push to **`madman3/DailyStandup`**.

## Automatic sync (optional): Bitbucket UI mirror

Some Bitbucket plans offer **Repository mirror** under **Repository settings**. You can add your GitHub repo URL with credentials per [Atlassian’s docs](https://support.atlassian.com/bitbucket-cloud/docs/use-repository-mirrors/). Use this **or** the pipeline mirror above, not both, unless you want double pushes.

## Railway

In Railway: **New project → Deploy from GitHub repo** → choose **`madman3/DailyStandup`**, set **root directory** to **`backend`**, add env vars. After you mirror, Railway tracks **GitHub**; keep Bitbucket as your main workflow and sync when you want Railway to rebuild.
