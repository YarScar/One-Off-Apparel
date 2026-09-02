#!/usr/bin/env bash
#
# One-time setup: create GitHub Actions OIDC provider and deploy role in AWS.
# Run this from your local machine with AdministratorAccess.
#
# Usage:
#   AWS_PROFILE=lp-internal bash infra/scripts/setup-github-oidc.sh
#
set -euo pipefail

ACCOUNT_ID="851725317896"
REGION="us-east-1"
ROLE_NAME="lp-github-deploy"
POLICY_NAME="lp-github-deploy-policy"
REPO="ckunkel/lp-internal-ai-v1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IAM_DIR="$SCRIPT_DIR/../iam"

echo "==> Step 1: Create GitHub Actions OIDC provider"

# Check if provider already exists
if aws iam get-open-id-connect-provider \
  --open-id-connect-provider-arn "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com" \
  >/dev/null 2>&1; then
  echo "    OIDC provider already exists — skipping."
else
  # Get the GitHub OIDC thumbprint (standard value for actions)
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    --tags Key=Project,Value=lp-internal-ai
  echo "    Created OIDC provider."
fi

echo "==> Step 2: Create deploy IAM policy"

# Check if policy exists
POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}"
if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  echo "    Policy already exists — updating to latest version."
  # Create a new version and set as default
  aws iam create-policy-version \
    --policy-arn "$POLICY_ARN" \
    --policy-document "file://${IAM_DIR}/lp-github-deploy-policy.json" \
    --set-as-default
else
  aws iam create-policy \
    --policy-name "$POLICY_NAME" \
    --policy-document "file://${IAM_DIR}/lp-github-deploy-policy.json" \
    --description "Allows GitHub Actions to push to ECR and deploy to ECS for lp-internal"
  echo "    Created policy: ${POLICY_ARN}"
fi

echo "==> Step 3: Create deploy IAM role"

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "    Role already exists — updating trust policy."
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "file://${IAM_DIR}/lp-github-deploy-trust-policy.json"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "file://${IAM_DIR}/lp-github-deploy-trust-policy.json" \
    --description "GitHub Actions deploy role for ${REPO}" \
    --tags Key=Project,Value=lp-internal-ai
  echo "    Created role: ${ROLE_NAME}"
fi

echo "==> Step 4: Attach policy to role"

aws iam attach-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-arn "$POLICY_ARN"
echo "    Attached ${POLICY_NAME} to ${ROLE_NAME}."

echo ""
echo "==> Done! Add this to your GitHub repo settings or workflow:"
echo ""
echo "    Role ARN: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"
echo ""
echo "    The deploy workflow (.github/workflows/deploy.yml) is already"
echo "    configured to use this role. Push to main to trigger a deploy."
