# Security

AURORA is an Alpha, single-user local application. The server binds to loopback and uses same-origin checks and an HttpOnly local-session cookie. Do not expose it directly on a public address, shared reverse proxy or multi-user host without a separately designed authentication and isolation layer.

## Credentials and external requests

Supply your own model and data API credentials. No developer key or account is bundled. Windows credentials use current-user DPAPI; other platforms use private files with restricted permissions rather than encryption. The local administrator/user account is part of the trust boundary.

Keys are handled by the local backend. Reading settings returns configuration metadata rather than keys. Do not include state directories, browser storage exports, research files, logs or backups in bug reports. Provider errors should be sanitized; redact any diagnostic material before sharing it.

Research prompts, attachments and selected tool results may be transmitted to the model provider you configured. Searches and data queries go to their respective providers. This is not an offline or air-gapped product. Provider permissions and data terms still apply.

## Research and files

The runtime limits workspace paths and does not provide a general shell or trading execution tool. Treat model responses, web results and uploaded documents as untrusted evidence, not executable instructions. The project does not guarantee the accuracy, completeness or freshness of financial data.

## Reporting

For a suspected vulnerability, avoid publishing reproduction details containing secrets in a public issue. Contact the repository owner through an available private GitHub channel or a repository private vulnerability report when enabled. If no private channel is available, open a minimal issue requesting a private contact without exploit details or credentials. Never send API keys.

Only the latest Alpha source is actively maintained; there is no stable-version support promise yet.
