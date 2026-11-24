#!/bin/bash
# Bakes the Stellr CI runner image on a fresh Ubuntu 24.04 machine. Run as EC2
# user data by bake-ami.sh, which stops the machine and images it once
# /var/lib/stellr-bake/done exists. Installs what CI's jobs expect from
# GitHub's ubuntu-latest image: git, Docker, gh, jq, shellcheck, the AWS CLI,
# Node (only to install Playwright's system libraries here; jobs bring their
# own Node through setup-node) and the Actions runner.
set -euxo pipefail
exec > >(tee /var/log/stellr-bake.log) 2>&1
# A failed bake powers off without the done marker, so bake-ami.sh stops waiting.
trap '[ -f /var/lib/stellr-bake/done ] || shutdown -h now' EXIT
export DEBIAN_FRONTEND=noninteractive
PLAYWRIGHT_VERSION="__PLAYWRIGHT_VERSION__"
NODE_MAJOR=24

apt-get update
apt-get -y upgrade
apt-get install -y --no-install-recommends \
  ca-certificates curl wget git git-lfs jq unzip zip xz-utils gzip tar bzip2 \
  shellcheck python3 python3-pip python3-venv build-essential pkg-config \
  docker.io docker-buildx docker-compose-v2 gh openssl rsync sudo locales tzdata
locale-gen en_US.UTF-8

# AWS CLI v2 (the runner reads its job config from SSM at boot).
curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install && rm -rf /tmp/aws /tmp/awscliv2.zip

# Node, from nodejs.org, checked against its published SHASUMS256.
ver=$(curl -fsSL https://nodejs.org/dist/index.json | jq -r "[.[] | select(.version | startswith(\"v${NODE_MAJOR}.\"))][0].version")
cd /tmp
curl -fsSLO "https://nodejs.org/dist/${ver}/node-${ver}-linux-x64.tar.xz"
curl -fsSL "https://nodejs.org/dist/${ver}/SHASUMS256.txt" | grep " node-${ver}-linux-x64.tar.xz\$" | sha256sum -c -
tar -xJf "node-${ver}-linux-x64.tar.xz" -C /usr/local --strip-components=1
rm -f "node-${ver}-linux-x64.tar.xz"

# Playwright's system libraries for the browsers CI uses.
npx --yes "playwright@${PLAYWRIGHT_VERSION}" install-deps chromium webkit

# The runner user: Docker and passwordless sudo, as on GitHub's image.
useradd -m -s /bin/bash runner
usermod -aG docker runner
echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner
chmod 0440 /etc/sudoers.d/runner
systemctl enable docker

# The Actions runner, latest release, checked against the SHA-256 in its notes.
rel=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)
rver=$(echo "$rel" | jq -r .tag_name | sed 's/^v//')
file="actions-runner-linux-x64-${rver}.tar.gz"
# The release notes carry it as <!-- BEGIN SHA linux-x64 -->hash<!-- END ... -->.
sum=$(echo "$rel" | jq -r .body | sed -n 's/.*BEGIN SHA linux-x64 -->[[:space:]]*\([0-9a-f]\{64\}\).*/\1/p' | head -1 || true)
mkdir -p /opt/actions-runner && cd /opt/actions-runner
curl -fsSLO "https://github.com/actions/runner/releases/download/v${rver}/${file}"
[ -n "$sum" ] || { echo "No linux-x64 checksum in the runner release notes; refusing to install."; exit 1; }
echo "${sum}  ${file}" | sha256sum -c -
tar -xzf "$file" && rm -f "$file"
./bin/installdependencies.sh
# Match GitHub's image where actions key caches on it (playwright-browsers).
printf 'ImageOS=ubuntu24\nLANG=en_US.UTF-8\nAGENT_TOOLSDIRECTORY=/opt/hostedtoolcache\nRUNNER_TOOL_CACHE=/opt/hostedtoolcache\n' > .env
mkdir -p /opt/hostedtoolcache
chown -R runner:runner /opt/actions-runner /opt/hostedtoolcache

# Nothing machine-specific in the image.
apt-get clean
rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*
cloud-init clean --logs || true
mkdir -p /var/lib/stellr-bake && echo "$rver" > /var/lib/stellr-bake/done
echo "STELLR_BAKE_OK runner ${rver}"
shutdown -h now
