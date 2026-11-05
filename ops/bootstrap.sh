#!/bin/bash
# Explicitly approved, one-time host preparation. Never run in CI or on clone.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root after host-change approval.' >&2; exit 1; }
[[ $# -le 1 ]] || { echo 'Usage: bootstrap.sh [optional-reviewed-emergency-ssh-key.pub]' >&2; exit 1; }
if [[ $# -eq 1 ]]; then [[ -f $1 ]]; fi
SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ $(/opt/node/bin/node -p 'process.versions.node.split(".")[0]') == 24 ]]
for tool in python3 sshd nginx logrotate flock sudo; do command -v "$tool" >/dev/null; done
[[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]
python3 - "${1:-}" <<'PY'
import os,socket,sys
from pathlib import Path
if sys.argv[1]:
    key=Path(sys.argv[1]).read_text().strip()
    parts=key.split()
    if len(parts)<2 or parts[0]!='ssh-ed25519':raise SystemExit('Use one reviewed ed25519 public key.')
    import base64
    if len(base64.b64decode(parts[1],validate=True))!=51:raise SystemExit('Invalid ed25519 public key.')
s=socket.socket();s.bind(('127.0.0.1',3005));s.close()
v=os.statvfs('/')
if v.f_bavail*v.f_frsize<5*1024**3:raise SystemExit('At least 5GiB free required.')
PY
getent passwd catan-friends >/dev/null || useradd --system --home-dir /var/lib/catan-friends --shell /usr/sbin/nologin catan-friends
getent passwd catan-friends-deploy >/dev/null || useradd --system --create-home --home-dir /home/catan-friends-deploy --shell /bin/sh catan-friends-deploy
[[ $(id -gn catan-friends) == catan-friends ]]
[[ $(id -gn catan-friends-deploy) == catan-friends-deploy ]]
install -d -o root -g root -m 0755 /opt/catan-friends /opt/catan-friends/releases /usr/local/lib/catan-friends-ops /var/lib/catan-friends-deploy-state
install -d -o root -g catan-friends -m 0750 /etc/catan-friends
install -d -o catan-friends -g catan-friends -m 0700 /var/lib/catan-friends
install -d -o root -g adm -m 0750 /var/log/catan-friends
for LOG in app.log network.log nginx-error.log; do
    [[ ! -L /var/log/catan-friends/$LOG ]]
    [[ -e /var/log/catan-friends/$LOG ]] || install -o root -g adm -m 0640 /dev/null "/var/log/catan-friends/$LOG"
    chown root:adm "/var/log/catan-friends/$LOG"
    chmod 0640 "/var/log/catan-friends/$LOG"
done
install -d -o root -g root -m 0700 /var/backups/catan-friends
install -d -o root -g root -m 0755 /var/www/catan-friends-acme /home/catan-friends-deploy /home/catan-friends-deploy/.ssh
install -o root -g root -m 0644 "$SOURCE"/{backup.py,storage.py} /usr/local/lib/catan-friends-ops/
install -o root -g root -m 0755 "$SOURCE/deploy.py" /usr/local/sbin/catan-friends-deploy
install -o root -g root -m 0644 "$SOURCE/catan-friends.service" /etc/systemd/system/catan-friends.service
[[ -e /etc/catan-friends/server.env ]] || install -o root -g catan-friends -m 0640 "$SOURCE/server.env.example" /etc/catan-friends/server.env
[[ -e /etc/nginx/sites-available/catan-friends ]] || install -o root -g root -m 0644 "$SOURCE/nginx.conf" /etc/nginx/sites-available/catan-friends
install -o root -g root -m 0644 "$SOURCE/logrotate.conf" /etc/logrotate.d/catan-friends
install -o root -g root -m 0644 "$SOURCE/catan-friends.cron" /etc/cron.d/catan-friends
printf 'catan-friends-deploy ALL=(root) NOPASSWD: /usr/local/sbin/catan-friends-deploy\n' >/etc/sudoers.d/catan-friends-deploy
chmod 0440 /etc/sudoers.d/catan-friends-deploy
visudo -cf /etc/sudoers.d/catan-friends-deploy
if [[ $# -eq 1 ]]; then
    KEY=$(awk 'NF { print $1 " " $2; exit }' "$1")
    printf 'restrict,command="/usr/bin/sudo -n /usr/local/sbin/catan-friends-deploy" %s\n' "$KEY" >/home/catan-friends-deploy/.ssh/authorized_keys
    chmod 0644 /home/catan-friends-deploy/.ssh/authorized_keys
    chown root:root /home/catan-friends-deploy/.ssh/authorized_keys
fi
systemctl daemon-reload
echo 'Prepared only. Service not started/enabled; Nginx site not enabled; DNS/cert/cloud permissions unchanged.'
