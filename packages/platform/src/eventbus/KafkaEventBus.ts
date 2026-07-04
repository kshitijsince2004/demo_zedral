import type { EventBus, EventEnvelope, EventHandler, EventPayload } from './EventBus';
import { assertCanonicalEventCompatible } from '../canonical/eventSchemas';
import { Kafka, type Consumer, type Producer } from 'kafkajs';

export class KafkaEventBus implements EventBus {
  private readonly kafka: Kafka;
  private readonly topicPrefix: string;
  private readonly publishRetries: number;
  private producer: Producer | null = null;
  private producerReady: Promise<void> | null = null;
  private readonly consumers = new Set<Consumer>();

  constructor(options?: {
    brokers?: readonly string[];
    clientId?: string;
    topicPrefix?: string;
    publishRetries?: number;
  }) {
    const brokers = options?.brokers ?? (process.env.KAFKA_BROKERS ?? '')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (brokers.length === 0) {
      throw new Error('KAFKA_BROKERS is required when EVENT_BUS_KIND=kafka');
    }

    this.kafka = new Kafka({
      clientId: options?.clientId ?? process.env.KAFKA_CLIENT_ID ?? 'zedral-core',
      brokers: [...brokers],
      retry: {
        retries: Number(process.env.KAFKA_RETRIES ?? 5),
      },
    });
    this.topicPrefix = options?.topicPrefix ?? process.env.KAFKA_TOPIC_PREFIX ?? 'zedral';
    this.publishRetries = options?.publishRetries ?? Number(process.env.EVENT_BUS_PUBLISH_RETRIES ?? 3);
  }

  async publish<TPayload extends EventPayload>(envelope: EventEnvelope<TPayload>): Promise<void> {
    assertCanonicalEventCompatible(envelope);
    const producer = await this.getProducer();
    const topic = this.topicFor(envelope.type);
    const payload = JSON.stringify(envelope);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.publishRetries; attempt += 1) {
      try {
        await producer.send({
          topic,
          messages: [{
            key: envelope.key,
            value: payload,
            headers: {
              eventType: envelope.type,
              version: String(envelope.version),
              tenantId: envelope.tenantId,
            },
          }],
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.publishRetries) {
          await delay(100 * (attempt + 1));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Kafka publish failed');
  }

  subscribe<TPayload extends EventPayload>(
    eventType: string,
    handler: EventHandler<TPayload>,
  ): () => void {
    const consumer = this.kafka.consumer({
      groupId: process.env.KAFKA_GROUP_ID ?? `zedral-core-${eventType}`,
    });
    let active = true;
    this.consumers.add(consumer);

    void this.startConsumer(consumer, eventType, async (envelope) => {
      if (!active) return;
      assertCanonicalEventCompatible(envelope);
      await handler(envelope as EventEnvelope<TPayload>);
    }).catch((error) => {
      console.error(`[KafkaEventBus] consumer for ${eventType} failed`, error);
    });

    return () => {
      active = false;
      this.consumers.delete(consumer);
      void consumer.disconnect().catch((error) => {
        console.error(`[KafkaEventBus] failed to disconnect consumer for ${eventType}`, error);
      });
    };
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled([
      ...Array.from(this.consumers).map((consumer) => consumer.disconnect()),
      this.producer?.disconnect() ?? Promise.resolve(),
    ]);
    this.consumers.clear();
    this.producer = null;
    this.producerReady = null;
  }

  private topicFor(eventType: string): string {
    return `${this.topicPrefix}.${eventType}`;
  }

  private async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        allowAutoTopicCreation: process.env.KAFKA_ALLOW_AUTO_TOPIC_CREATION !== 'false',
      });
      this.producerReady = this.producer.connect();
    }
    await this.producerReady;
    return this.producer;
  }

  private async startConsumer(
    consumer: Consumer,
    eventType: string,
    handler: (envelope: EventEnvelope) => Promise<void>,
  ): Promise<void> {
    await consumer.connect();
    await consumer.subscribe({
      topic: this.topicFor(eventType),
      fromBeginning: process.env.KAFKA_FROM_BEGINNING === 'true',
    });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const parsed = JSON.parse(message.value.toString()) as EventEnvelope;
        await handler(parsed);
      },
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
