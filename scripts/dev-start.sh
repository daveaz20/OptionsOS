#!/bin/bash
# Start API server in background
PORT=3000 pnpm --filter api-server dev &

# Wait for API to boot
sleep 3

# Start frontend
BASE_PATH=/ pnpm --filter options-platform dev
