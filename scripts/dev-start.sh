#!/bin/bash
# Kill any processes on ports 3000 and 3001
fuser -k 3000/tcp 2>/dev/null || true
fuser -k 3001/tcp 2>/dev/null || true
sleep 1

# Start API server in background
PORT=3000 pnpm --filter api-server dev &

# Wait for API to boot
sleep 3

# Start frontend
BASE_PATH=/ pnpm --filter options-platform dev
