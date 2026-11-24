#!/bin/bash
# Deploys (or updates) the stellr-ci-runners stack in us-east-2.
#   AWS_PROFILE=stellr bash ops/ci-runners/deploy.sh [budget-email]
# Needs, once: the image (bake-ami.sh), and the two SecureString parameters
# /stellr/ci-runners/github-token and /stellr/ci-runners/webhook-secret
# (README.md, "Set up").
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=${AWS_REGION:-us-east-2}
account=$(aws sts get-caller-identity --query Account --output text)
bucket="stellr-ci-runners-code-${account}"

if ! aws s3api head-bucket --bucket "$bucket" 2>/dev/null; then
  aws s3api create-bucket --bucket "$bucket" --create-bucket-configuration "LocationConstraint=${AWS_REGION}" >/dev/null
  aws s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

zip=$(mktemp -d)/runners.zip
(cd lambda && zip -q -X "$zip" runners.py)
key="runners-$(shasum -a 256 "$zip" | cut -c1-16).zip"
aws s3 cp --quiet "$zip" "s3://${bucket}/${key}"

vpc=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
subnets=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text | tr '\t' ',')

aws cloudformation deploy --stack-name stellr-ci-runners --template-file template.yml \
  --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
  --tags project=stellr-ci-runners \
  --parameter-overrides VpcId="$vpc" SubnetIds="$subnets" CodeBucket="$bucket" CodeKey="$key" BudgetEmail="${1:-}"

aws cloudformation describe-stacks --stack-name stellr-ci-runners \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookUrl`].OutputValue' --output text
