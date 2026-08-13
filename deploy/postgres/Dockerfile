# Postgres 15 + pgaudit (SAFE_CHANGE item 7).
# QA soak before on-prem. Rollback: image postgres:15-alpine.
FROM postgres:15

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-15-pgaudit \
  && rm -rf /var/lib/apt/lists/*

COPY pgaudit.conf /etc/postgresql/pgaudit.conf

CMD ["postgres", "-c", "shared_preload_libraries=pgaudit", "-c", "pgaudit.log=ddl,role,write"]
