#!/usr/bin/env bash
# Prepares a new Ubuntu 24.04 server for ECCS, once (Stage H, 19 Oct 2026). From the PC:
#
#   scp -i <key.pem> infra/server/setup-server.sh ubuntu@<server>:~
#   ssh -i <key.pem> ubuntu@<server> "sudo bash setup-server.sh"
#
# It installs Docker (from Docker's own package source, as Docker's documentation describes),
# adds 2 GB of swap, opens the firewall to SSH, 80 and 443 only, turns on automatic security
# updates, and makes the folder /opt/eccs for compose.yml, the Caddyfile and the settings.
# Safe to run again: each step checks whether it is already done.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo: sudo bash setup-server.sh"
  exit 1
fi
# The login that will run the deploys (the one that called sudo; "ubuntu" on Lightsail).
OWNER="${SUDO_USER:-ubuntu}"
. /etc/os-release
if [ "${VERSION_ID:-}" != "24.04" ]; then
  echo "Warning: this was written for Ubuntu 24.04; this is ${PRETTY_NAME:-unknown}."
fi
export DEBIAN_FRONTEND=noninteractive

echo "== 1. System updates"
apt-get update
apt-get -y upgrade
apt-get install -y ca-certificates curl ufw unattended-upgrades

echo "== 2. Docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
# Every container's log is capped (compose.yml caps ECCS's own too).
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
JSON
fi
systemctl enable docker
systemctl restart docker
# The deploy login may use Docker without sudo.
usermod -aG docker "$OWNER"

echo "== 3. 2 GB of swap"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Use the swap only when memory is really short: it is there to avoid a crash, not to run from.
echo 'vm.swappiness=10' > /etc/sysctl.d/90-eccs-swap.conf
sysctl -q -p /etc/sysctl.d/90-eccs-swap.conf

echo "== 4. Firewall: SSH, 80 and 443 only"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
# Note: ports Docker publishes are opened by Docker itself, past ufw. Only Caddy publishes any
# (80 and 443), which is what is wanted. Lightsail's own firewall (its Networking tab) is the
# outer wall and must allow the same three.

echo "== 5. Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
systemctl enable --now unattended-upgrades

echo "== 6. The ECCS folder"
install -d -m 750 -o "$OWNER" -g "$OWNER" /opt/eccs

echo ""
echo "Done. $(docker --version); $(docker compose version)"
swapon --show
ufw status
echo ""
echo "Log out and in again (so '$OWNER' can use Docker), then put the settings file in /opt/eccs/.env."
if [ -f /var/run/reboot-required ]; then
  echo "The updates need a restart: sudo reboot"
fi
