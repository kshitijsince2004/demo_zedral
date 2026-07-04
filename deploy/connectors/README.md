# Zedral Connector Deployment

The connector image is the separately deployable M1 / Manifold edge runtime described by D12/D12b. It builds only the connector framework and platform contracts; it does not include the core server or module packages.

Build:

```sh
docker build -f deploy/connectors/Dockerfile -t zedral-connectors:local .
```

Run:

```sh
docker run --rm \
  -e EVENT_BUS_KIND=kafka \
  -e KAFKA_BROKERS=redpanda:9092 \
  -e KAFKA_TOPIC_PREFIX=zedral \
  zedral-connectors:local
```

Client-specific plugins are added under `packages/connectors/src/plugins/` and registered from `packages/connectors/src/plugins/index.ts`.
