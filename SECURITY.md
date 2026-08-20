# Security

## Listen-along networking

The listen-along HTTP server remains idle until a valid session is shared. It closes after the final local session is cleared.

While a session is active, the client binds a random TCP port on `0.0.0.0` so invited devices can connect. Session and stream routes require the session token. Treat listen-along links as credentials: do not publish them, store them in logs, or send them to people who should not receive the stream.

Automatic UPnP port mapping is disabled by default. It can be explicitly enabled for environments that require internet reachability by setting:

```text
APOLLO_LISTEN_ALONG_UPNP=1
```

Enabling that option asks a compatible router to expose the temporary listen-along port. Use it only on a trusted network and only when the additional exposure is understood.

## Runtime plugins

Apollo runtime plugins execute as trusted client code. Install plugins only from reviewed sources and inspect updates before enabling them. A plugin can access the same renderer data and network capabilities exposed to other trusted client code.

## Reporting a vulnerability

Do not publish exploitable details, tokens, private server addresses, logs, or credentials in a public issue. Use GitHub's private vulnerability reporting flow from the repository Security tab when it is available. Otherwise contact the repository owner privately with the affected version, reproduction steps, impact, and a minimal proof of concept that contains no third-party secrets.
