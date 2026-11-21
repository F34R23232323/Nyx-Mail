# Sample Rspamd controller configuration for NyxMail.
#
# Copy this file to config/rspamd/local.d/worker-controller.inc (which is
# git-ignored) and set the same password in RSPAMD_PASSWORD in .env:
#
#   cp config/rspamd/worker-controller.example.inc \
#      config/rspamd/local.d/worker-controller.inc
#
# Keep the controller on loopback. The password is sent by the web app, so the
# service stays protected if you change secure_ip or expose the port.

bind_socket = "127.0.0.1:11334";

password = "change-me-rspamd-controller";
enable_password = "change-me-rspamd-controller";

secure_ip = "127.0.0.1";
secure_ip = "::1";

allow_file_and_shm_inputs = false;
