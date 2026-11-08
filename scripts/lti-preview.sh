#!/usr/bin/env bash
# Deploys a PREVIEW of English Detective with UniGame Hub (LTI) sign-in enabled, without touching
# the live service: a separate Cloud Run service (detective-api-lti-preview) + a Firebase Hosting preview channel
# "lti" on the detective hosting target (site k26-detective).
# NOTE: the preview shares the production Firestore database "detective" and Firebase Auth of PROJECT_ID.
#
#   bash scripts/lti-preview.sh
#
# Env: PROJECT_ID (default k26game1), REGION, HUB_URL, HUB_PROJECT (holds game-secret-k26game2),
#      LTI_SECRET_NAME (secret in PROJECT_ID, default unigamehub-secret-k26game2),
#      LTI_TENANT_MAP (default aiedu-local=demo-university), GEMINI_MODEL (default gemini-3-flash-preview),
#      VERTEX_LOCATION (default global), SITE_ID (default k26-detective), GCLOUD_ACCOUNT (project owner account)
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_ID="${PROJECT_ID:-k26game1}"
REGION="${REGION:-asia-southeast1}"
SITE_ID="${SITE_ID:-k26-detective}"
HUB_URL="${HUB_URL:-https://unigame-hub-423573033950.asia-southeast1.run.app}"
HUB_PROJECT="${HUB_PROJECT:-gamehub-514101}"
SECRET="${LTI_SECRET_NAME:-unigamehub-secret-k26game2}"
LTI_TENANT_MAP="${LTI_TENANT_MAP:-aiedu-local=demo-university}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3-flash-preview}"
VERTEX_LOCATION="${VERTEX_LOCATION:-global}"
ACCOUNT_ARGS=(); [[ -n "${GCLOUD_ACCOUNT:-}" ]] && ACCOUNT_ARGS=(--account "${GCLOUD_ACCOUNT}")
SA="detective-api@${PROJECT_ID}.iam.gserviceaccount.com"
TAG="lti-$(git rev-parse --short HEAD 2>/dev/null || date +%s)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/detective/detective-api:${TAG}"
FIREBASE="npx --yes firebase-tools@14.27.0"

echo "==> 1/6 Shared secret for result tokens (copied from the Hub project, never printed)"
if ! gcloud secrets describe "${SECRET}" --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" >/dev/null 2>&1; then
  gcloud secrets versions access latest --secret game-secret-k26game2 --project "${HUB_PROJECT}" | tr -d '\r\n' |
    gcloud secrets create "${SECRET}" --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" --replication-policy automatic --data-file=-
fi

echo "==> 2/6 IAM: runtime SA may read the secret and sign Firebase custom tokens (signBlob on itself)"
gcloud secrets add-iam-policy-binding "${SECRET}" --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" \
  --member "serviceAccount:${SA}" --role roles/secretmanager.secretAccessor >/dev/null
gcloud iam service-accounts add-iam-policy-binding "${SA}" --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" \
  --member "serviceAccount:${SA}" --role roles/iam.serviceAccountTokenCreator >/dev/null

echo "==> 3/6 Build API image ${IMAGE} (Cloud Build)"
gcloud builds submit --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" --config infrastructure/cloudbuild.api.yaml --substitutions "_IMAGE=${IMAGE}" .

echo "==> 4/6 Deploy preview service detective-api-lti-preview (same settings as detective-api + LTI)"
gcloud run deploy detective-api-lti-preview --project "${PROJECT_ID}" "${ACCOUNT_ARGS[@]}" --region "${REGION}" --image "${IMAGE}" --quiet \
  --service-account "${SA}" --allow-unauthenticated \
  --memory 1Gi --cpu 1 --concurrency 40 --timeout 300 --min-instances 0 --max-instances 3 \
  --set-env-vars "^|^NODE_ENV=production|GCP_PROJECT_ID=${PROJECT_ID}|FIRESTORE_DATABASE=detective|VERTEX_LOCATION=${VERTEX_LOCATION}|GEMINI_MODEL=${GEMINI_MODEL}|LMS_SERVICE_ACCOUNTS=${LMS_SERVICE_ACCOUNTS:-vstep-api@${PROJECT_ID}.iam.gserviceaccount.com}|LOG_LEVEL=info|LTI_ENABLED=true|LTI_HUB_URL=${HUB_URL}|LTI_GAME_ID=k26game2|LTI_TENANT_MAP=${LTI_TENANT_MAP}" \
  --update-secrets "LTI_GAME_SECRET=${SECRET}:latest"

echo "==> 5/6 Build web (reads apps/web/.env.production[.local])"
npm run build --workspace @ed/web

echo "==> 6/6 Hosting preview channel 'lti' (7 days) on target detective (site ${SITE_ID}, see .firebaserc) with /api -> detective-api-lti-preview"
${FIREBASE} hosting:channel:deploy lti --only detective --config firebase.preview.json --project "${PROJECT_ID}" --expires 7d ${GCLOUD_ACCOUNT:+--account "$GCLOUD_ACCOUNT"}
