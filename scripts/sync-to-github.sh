#!/usr/bin/env sh
# Push the current branch to Bitbucket (origin) and GitHub (github).
# Usage: ./scripts/sync-to-github.sh
# Requires: git remote "github" -> git@github.com:madman3/DailyStandup.git
#           SSH access to both Bitbucket and GitHub.

set -e
branch=$(git branch --show-current)
echo "Pushing branch: $branch"
git push origin "$branch"
git push github "$branch"
echo "Synced origin + github."
