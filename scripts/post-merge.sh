#!/bin/bash
set -e
# Post-merge setup for GABA: install/upgrade Python deps to match requirements.txt.
# Idempotent and non-interactive. Workflow reconciliation handles restarts.
if [ -f requirements.txt ]; then
  python -m pip install --quiet --upgrade --disable-pip-version-check -r requirements.txt
fi
