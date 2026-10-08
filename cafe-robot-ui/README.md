# Café Robot Web UI

React app built with Vite. The production bundle is served from `dist/` by
`start_robot.sh` on port 3000. ROS communication uses rosbridge on port 9090.

## Development

```bash
npm install
npm run dev
```

Open `http://<raspberry-pi-address>:3000` while the development server is
running.

## Production build

```bash
npm run build
```

After rebuilding, restart `robot.service` to serve the updated `dist/` files.
