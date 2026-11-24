#!/bin/bash
# Bakes a new runner image and points /stellr/ci-runners/ami-id at it.
#   AWS_PROFILE=stellr bash ops/ci-runners/bake-ami.sh
# Then redeploy (deploy.sh) so the launch template picks up the new image.
# The bake machine is on-demand, about 30-60 minutes, under $0.10.
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION=${AWS_REGION:-us-east-2}
pw=$(node -p "require('../../package.json').devDependencies['@playwright/test'].replace(/^[^0-9]*/, '')")
base=$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)
subnet=$(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query 'Subnets[0].SubnetId' --output text)
userdata=$(sed "s/__PLAYWRIGHT_VERSION__/${pw}/" bake-userdata.sh)

echo "Baking from ${base} (Ubuntu 24.04), Playwright ${pw}"
iid=$(aws ec2 run-instances --image-id "$base" --instance-type m7i-flex.large --subnet-id "$subnet" \
  --associate-public-ip-address \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
  --instance-initiated-shutdown-behavior stop \
  --user-data "$userdata" \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=stellr-ci-runner-bake}]' \
  --query 'Instances[0].InstanceId' --output text)
trap 'aws ec2 terminate-instances --instance-ids "$iid" >/dev/null' EXIT
echo "Bake machine ${iid}; waiting for it to stop (about 30-60 minutes; Playwright's system libraries are slow to fetch)"
for i in $(seq 1 160); do
  # A dropped connection or an expiring login is not a failed bake: keep waiting.
  state=$(aws ec2 describe-instances --instance-ids "$iid" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null || echo unknown)
  [ "$state" = stopped ] && break
  sleep 30
done
[ "$state" = stopped ] || { echo "The bake did not finish in 80 minutes (state: $state)."; exit 1; }
if ! aws ec2 get-console-output --instance-id "$iid" --latest --query Output --output text | grep -q 'STELLR_BAKE_OK runner'; then
  echo "The bake failed: see the console output of ${iid} before it is terminated:"
  aws ec2 get-console-output --instance-id "$iid" --latest --query Output --output text | tail -n 40
  exit 1
fi

name="stellr-ci-runner-$(date -u +%Y%m%d-%H%M)"
ami=$(aws ec2 create-image --instance-id "$iid" --name "$name" --description "Stellr CI runner (ops/ci-runners)" \
  --tag-specifications "ResourceType=image,Tags=[{Key=stellr-ci-runner-image,Value=1}]" "ResourceType=snapshot,Tags=[{Key=stellr-ci-runner-image,Value=1}]" \
  --query ImageId --output text)
echo "Imaging ${ami}"
aws ec2 wait image-available --image-ids "$ami"
aws ssm put-parameter --name /stellr/ci-runners/ami-id --type String --data-type aws:ec2:image --value "$ami" --overwrite >/dev/null
echo "Done: /stellr/ci-runners/ami-id = ${ami}"
