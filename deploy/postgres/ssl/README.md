# App↔DB SSL (SAFE_CHANGE #15)

1. Generate server cert/key (QA first). Place as `server.crt` / `server.key` here.
2. Mount `./postgres/ssl` into the db container and enable `ssl=on` (see comments in `docker-compose.prod.yml`).
3. Set `DATABASE_SSL=true` on the backend (after server is accepting SSL).
4. Confirm `/health` green before promoting.

Rollback: unset `DATABASE_SSL`, remove ssl command from db.
