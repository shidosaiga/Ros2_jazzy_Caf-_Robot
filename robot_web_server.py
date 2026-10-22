#!/usr/bin/env python3
"""Serve the built dashboard and provide same-origin Pi power controls."""

import argparse
import json
import os
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RobotWebHandler(SimpleHTTPRequestHandler):
    power_action_pending = False
    power_action_lock = threading.Lock()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def do_POST(self):
        actions = {
            "/api/system/reboot": ("reboot", "restarting"),
            "/api/system/shutdown": ("poweroff", "shutting down"),
        }
        action = actions.get(self.path)
        if action is None:
            self.send_json_error(404, "Unknown endpoint")
            return

        origin = self.headers.get("Origin")
        host = self.headers.get("Host")
        if not origin or not host or origin != f"http://{host}":
            self.send_json_error(
                403,
                "Origin mismatch. Open the dashboard directly from this Pi address.",
            )
            return

        command, message = action
        if not self.can_run_system_action(command):
            self.send_json_error(
                403,
                "Power control is not authorized. Install scripts/cafe-robot-web-power.sudoers.",
            )
            return

        with type(self).power_action_lock:
            if type(self).power_action_pending:
                self.send_json_error(409, "A system action is already pending")
                return
            type(self).power_action_pending = True

        payload = json.dumps({"status": message}, ensure_ascii=False).encode()
        self.send_response(202)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

        # Let the HTTP response reach the browser before systemd stops this server.
        threading.Timer(1.5, self.run_system_action, args=(command,)).start()

    def send_json_error(self, status, message):
        payload = json.dumps({"error": message}, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    @staticmethod
    def systemctl_command(command):
        systemctl = ["/usr/bin/systemctl", command]
        if os.geteuid() == 0:
            return systemctl
        return ["/usr/bin/sudo", "-n", *systemctl]

    @classmethod
    def can_run_system_action(cls, command):
        try:
            result = subprocess.run(
                ["/usr/bin/sudo", "-n", "-l", "/usr/bin/systemctl", command],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=3,
                check=False,
            ) if os.geteuid() != 0 else None
            return result is None or result.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    @classmethod
    def run_system_action(cls, command):
        try:
            subprocess.run(cls.systemctl_command(command), check=True, timeout=15)
        except (OSError, subprocess.SubprocessError) as error:
            print(f"Could not run systemctl {command}: {error}", flush=True)
            with cls.power_action_lock:
                cls.power_action_pending = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=3000)
    args = parser.parse_args()

    handler = lambda *handler_args, **handler_kwargs: RobotWebHandler(
        *handler_args, directory=args.directory, **handler_kwargs
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving dashboard on {args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
