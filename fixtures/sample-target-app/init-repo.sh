#!/bin/bash
# Initialize the sample-target-app fixture as a standalone git repo.
# Run this once after cloning the harness repo.
set -e
cd "$(dirname "$0")"
if [ -d .git ]; then
  echo "Fixture repo already initialized."
  exit 0
fi
git init
git checkout -b development
git add .
git commit -m "init: sample target app fixture"
echo "Fixture repo initialized on branch 'development'."
