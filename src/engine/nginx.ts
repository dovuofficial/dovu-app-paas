export interface NginxConfigOptions {
  serverName: string;
  hostPort: number;
  upstream?: string; // defaults to 127.0.0.1 (for containers on same host)
}

export function generateNginxConfig(options: NginxConfigOptions): string {
  const upstream = options.upstream || "127.0.0.1";
  return `server {
    listen 80;
    server_name ${options.serverName};

    location / {
        proxy_pass http://${upstream}:${options.hostPort};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
`;
}
