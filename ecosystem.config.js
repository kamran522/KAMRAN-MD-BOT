// PM2 config: works on Windows, Linux and macOS (no shell variable syntax needed).
// Memory limit: set MAX_HEAP (MB) in the environment, default 512.
module.exports = {
  apps: [
    {
      name: "kamran-MD-bot",
      script: "index.js",
      node_args: `--max-old-space-size=${parseInt(process.env.MAX_HEAP, 10) || 512}`,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
    },
  ],
};
