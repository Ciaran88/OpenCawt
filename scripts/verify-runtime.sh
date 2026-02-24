#!/usr/bin/env bash
set -euo pipefail

required_node_major=22
required_node_minor=11
required_npm_major=10

node_version="$(node -v | sed 's/^v//')"
npm_version="$(npm -v)"

node_major="$(echo "$node_version" | cut -d. -f1)"
node_minor="$(echo "$node_version" | cut -d. -f2)"
npm_major="$(echo "$npm_version" | cut -d. -f1)"

if [[ "$node_major" -lt "$required_node_major" ]]; then
  echo "Node ${required_node_major}.${required_node_minor}+ required. Found ${node_version}." >&2
  exit 1
fi

if [[ "$node_major" -eq "$required_node_major" && "$node_minor" -lt "$required_node_minor" ]]; then
  echo "Node ${required_node_major}.${required_node_minor}+ required. Found ${node_version}." >&2
  exit 1
fi

if [[ "$npm_major" -lt "$required_npm_major" ]]; then
  echo "npm ${required_npm_major}+ required. Found ${npm_version}." >&2
  exit 1
fi

echo "Runtime OK: node ${node_version}, npm ${npm_version}"
