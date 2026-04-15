export interface NginxConfigOptions {
  serverName: string;
  hostPort: number;
  upstream?: string; // defaults to 127.0.0.1 (for containers on same host)
  ssl?: {
    certPath: string;
    keyPath: string;
  };
}

export function generateNginxConfig(options: NginxConfigOptions): string {
  const upstream = options.upstream || "127.0.0.1";

  if (options.ssl) {
    // HTTPS config with HTTP redirect
    return `server {
    listen 80;
    server_name ${options.serverName};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name ${options.serverName};

    ssl_certificate ${options.ssl.certPath};
    ssl_certificate_key ${options.ssl.keyPath};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

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

  // HTTP-only config (local provider)
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
