#!/usr/bin/env bash
# Creates the ONE new R2 bucket this app needs.
# It creates nothing else and touches no existing Cloudflare project.
#
# Run once, on the machine where you have already done `wrangler login`:
#   bash scripts/setup-r2.sh
set -euo pipefail

BUCKET="shop-web-images"

echo "Cloudflare account:"
npx wrangler whoami

echo
echo "Creating R2 bucket: $BUCKET"
npx wrangler r2 bucket create "$BUCKET"

echo
echo "Buckets now on the account:"
npx wrangler r2 bucket list

echo
echo "Done. The binding is already declared in wrangler.jsonc as IMAGES."
echo "Nothing has been deployed."
